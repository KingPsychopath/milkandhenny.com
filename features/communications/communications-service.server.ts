import { Context, Effect, Layer, Queue } from "effect";
import type { OperationKind } from "@/lib/platform/effect-boundary.server";

import { reconcileActiveWaitlists } from "@/features/event-waitlist/waitlist.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { EmailProviderService } from "@/lib/platform/provider-services.server";
import {
  claimEmailOutboxBatch,
  expireUndeliverableEmailMessages,
  finishEmailOutboxAttempt,
  setEmailOutboxEffectWake,
} from "@/lib/platform/email-outbox.server";
import { log } from "@/lib/platform/logger.server";
import { BASE_URL } from "@/lib/shared/config";
import { expandDueCommunicationStages } from "./communication-plans.server";
import {
  sendCommunicationPlanTest,
  sendCommunicationStageNow,
  sendCommunicationStageToMissingRecipients,
} from "./communication-plans.server";
import { saveCommunication } from "./communications.server";
import { cleanupExpiredCommunicationLinks } from "./email-links.server";
import { previewEventBroadcast, queueEventBroadcast } from "./event-broadcast.server";
import {
  cancelQueuedEmail,
  cleanupEmailOperations,
  correctTicketRecipientAndResend,
  removeEmailSuppression,
  resendEmailFromLedger,
  retryEmailNow,
  revealEmailLedgerRecipient,
} from "@/features/email-operations/email-operations.server";

const DELIVERY_CONCURRENCY = 8;

function operation<A>(
  name: string,
  run: (signal: AbortSignal) => Promise<A>,
  kind: OperationKind = "idempotent-mutation",
) {
  return eventsOperation(
    {
      domain: "communications",
      operation: name,
      kind,
      timeoutMs: 45_000,
    },
    run,
  );
}

/** Drain the durable Postgres outbox with bounded Effect-owned delivery concurrency. */
function drain(email: typeof EmailProviderService.Service) {
  return Effect.gen(function* () {
    let handled = yield* operation("expire_email", () => expireUndeliverableEmailMessages());
    for (;;) {
      const rows = yield* operation("claim_email", () => claimEmailOutboxBatch());
      if (rows.length === 0) return handled;
      yield* Effect.forEach(
        rows,
        (row) => operation("deliver_email", () => finishEmailOutboxAttempt(row, email.send)),
        { concurrency: DELIVERY_CONCURRENCY, discard: true },
      );
      handled += rows.length;
      if (rows.length < DELIVERY_CONCURRENCY) return handled;
    }
  }).pipe(Effect.withSpan("communications.outbox.drain"));
}

export class CommunicationsService extends Context.Service<
  CommunicationsService,
  {
    readonly drain: Effect.Effect<number, unknown>;
    readonly previewEventBroadcast: (
      input: Parameters<typeof previewEventBroadcast>[0],
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof previewEventBroadcast>>>>;
    readonly queueEventBroadcast: (
      input: Parameters<typeof queueEventBroadcast>[0],
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof queueEventBroadcast>>>>;
    readonly save: (
      input: Parameters<typeof saveCommunication>[0],
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof saveCommunication>>>>;
    readonly sendPlanTest: (
      ...input: Parameters<typeof sendCommunicationPlanTest>
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof sendCommunicationPlanTest>>>>;
    readonly sendStageNow: (
      ...input: Parameters<typeof sendCommunicationStageNow>
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof sendCommunicationStageNow>>>>;
    readonly sendStageToMissing: (
      ...input: Parameters<typeof sendCommunicationStageToMissingRecipients>
    ) => ReturnType<
      typeof operation<Awaited<ReturnType<typeof sendCommunicationStageToMissingRecipients>>>
    >;
    readonly cleanupEmail: Effect.Effect<
      Awaited<ReturnType<typeof cleanupEmailOperations>>,
      unknown
    >;
    readonly cancelEmail: (id: string) => ReturnType<typeof operation<void>>;
    readonly correctTicketRecipient: (
      ...input: Parameters<typeof correctTicketRecipientAndResend>
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof correctTicketRecipientAndResend>>>>;
    readonly removeSuppression: (recipientHash: string) => ReturnType<typeof operation<void>>;
    readonly resendEmail: (
      ...input: Parameters<typeof resendEmailFromLedger>
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof resendEmailFromLedger>>>>;
    readonly retryEmail: (id: string) => ReturnType<typeof operation<void>>;
    readonly revealRecipient: (
      id: string,
    ) => ReturnType<typeof operation<Awaited<ReturnType<typeof revealEmailLedgerRecipient>>>>;
    readonly cleanupLinks: Effect.Effect<
      Awaited<ReturnType<typeof cleanupExpiredCommunicationLinks>>,
      unknown
    >;
    readonly runScheduled: Effect.Effect<
      {
        staged: number;
        waitlistAlerts: number;
        handled: number;
      },
      unknown
    >;
  }
>()("CommunicationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const email = yield* EmailProviderService;
      const wakeQueue = yield* Queue.sliding<void>(1);
      const drainEffect = drain(email);
      const wakeLoop = Effect.forever(
        Queue.take(wakeQueue).pipe(
          Effect.andThen(drainEffect),
          Effect.catch((error) =>
            Effect.sync(() =>
              log.error("communications.outbox", "Wake-driven email drain failed", {}, error),
            ),
          ),
        ),
      );

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          setEmailOutboxEffectWake(() => {
            Effect.runSync(Queue.offer(wakeQueue, undefined));
          }),
        ),
        () => Effect.sync(() => setEmailOutboxEffectWake(null)),
      );
      yield* Effect.forkScoped(wakeLoop);

      return {
        cancelEmail: (id) => operation("cancel_email", () => cancelQueuedEmail(id), "mutation"),
        cleanupEmail: operation("cleanup_email", () => cleanupEmailOperations()),
        cleanupLinks: operation("cleanup_links", () => cleanupExpiredCommunicationLinks()),
        correctTicketRecipient: (...input) =>
          operation(
            "correct_ticket_recipient",
            () => correctTicketRecipientAndResend(...input),
            "mutation",
          ),
        drain: drainEffect,
        previewEventBroadcast: (input) =>
          operation("preview_event_broadcast", () => previewEventBroadcast(input), "read"),
        queueEventBroadcast: (input) =>
          operation("queue_event_broadcast", () => queueEventBroadcast(input)),
        save: (input) =>
          operation("save_communication", () => saveCommunication(input), "mutation"),
        removeSuppression: (recipientHash) =>
          operation(
            "remove_email_suppression",
            () => removeEmailSuppression(recipientHash),
            "mutation",
          ),
        resendEmail: (...input) =>
          operation("resend_email", () => resendEmailFromLedger(...input), "mutation"),
        retryEmail: (id) => operation("retry_email", () => retryEmailNow(id)),
        revealRecipient: (id) =>
          operation("reveal_email_recipient", () => revealEmailLedgerRecipient(id), "read"),
        sendPlanTest: (...input) =>
          operation("send_plan_test", () => sendCommunicationPlanTest(...input), "mutation"),
        sendStageNow: (...input) =>
          operation("send_stage_now", () => sendCommunicationStageNow(...input)),
        sendStageToMissing: (...input) =>
          operation("send_stage_to_missing", () =>
            sendCommunicationStageToMissingRecipients(...input),
          ),
        runScheduled: Effect.gen(function* () {
          const [staged, waitlistAlerts] = yield* Effect.all(
            [
              operation("expand_stages", () => expandDueCommunicationStages()),
              operation("reconcile_waitlists", () => reconcileActiveWaitlists(BASE_URL)),
            ],
            { concurrency: 2 },
          );
          const handled = yield* drainEffect;
          return { staged, waitlistAlerts, handled };
        }).pipe(Effect.withSpan("communications.scheduled")),
      };
    }),
  );
}
