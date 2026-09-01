import { Context, Effect, Layer, Queue } from "effect";

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
import { cleanupExpiredCommunicationLinks } from "./email-links.server";
import { cleanupEmailOperations } from "@/features/email-operations/email-operations.server";

const DELIVERY_CONCURRENCY = 8;

function operation<A>(name: string, run: (signal: AbortSignal) => Promise<A>) {
  return eventsOperation(
    {
      domain: "communications",
      operation: name,
      kind: "idempotent-mutation",
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
    readonly cleanupEmail: Effect.Effect<
      Awaited<ReturnType<typeof cleanupEmailOperations>>,
      unknown
    >;
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
        cleanupEmail: operation("cleanup_email", () => cleanupEmailOperations()),
        cleanupLinks: operation("cleanup_links", () => cleanupExpiredCommunicationLinks()),
        drain: drainEffect,
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
