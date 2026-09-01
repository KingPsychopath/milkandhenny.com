import { Context, Effect, Layer } from "effect";

import { claimStaffAward } from "@/features/event-scoring/staff-award-claims.server";
import {
  getWaitlistManagement,
  listEventWaitlist,
  previewWaitlistImpact,
  reconcileEventWaitlist,
  requestEventWaitlist,
  updateWaitlistManagement,
} from "@/features/event-waitlist/waitlist.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { disableEventDrop, enableEventDrop, getEventDrop } from "@/features/events/drop.server";
import {
  fulfilCheckout,
  refundOrder,
  refundTicket,
  resolveCheckoutOutcome,
  startCheckout,
} from "@/features/tickets/checkout.server";
import { checkpointScan, undoCheckpointUse } from "@/features/tickets/checkpoints.server";
import {
  beginTicketExchange,
  fulfilTicketExchangeCheckout,
  resolveTicketExchangeOutcome,
} from "@/features/tickets/exchange.server";
import { withPaymentProvider } from "@/lib/platform/payment-provider-context.server";
import { PaymentsService } from "@/lib/platform/provider-services.server";
import {
  inviteAdminTicket,
  issueAdminComp,
  resendAdminTicketOrder,
} from "./admin-ticket-operations.server";
import { eventCancellationPending, runEventCancellation } from "./cancellation.server";
import { handleStripeWebhookEvent } from "./stripe-webhook.server";

function mutation<A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
  timeoutMs = 45_000,
) {
  return eventsOperation(
    { domain: "event-operations", operation, kind: "mutation", timeoutMs },
    run,
  );
}

function idempotent<A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
  timeoutMs = 45_000,
) {
  return eventsOperation(
    { domain: "event-operations", operation, kind: "idempotent-mutation", timeoutMs },
    run,
  );
}

function makeEventOperations(payments: typeof PaymentsService.Service) {
  const withPayments = <A>(run: () => Promise<A>) => withPaymentProvider(payments.port, run);

  const cancellationPending = (...args: Parameters<typeof eventCancellationPending>) =>
    eventsOperation({ domain: "event-operations", operation: "cancellation_pending" }, () =>
      withPayments(() => eventCancellationPending(...args)),
    );
  const cancelEvent = (...args: Parameters<typeof runEventCancellation>) =>
    idempotent("cancel_event", () => withPayments(() => runEventCancellation(...args)), 5 * 60_000);
  const claimAward = (...args: Parameters<typeof claimStaffAward>) =>
    idempotent("claim_award", () => withPayments(() => claimStaffAward(...args)));
  const scanCheckpoint = (...args: Parameters<typeof checkpointScan>) =>
    idempotent("checkpoint_scan", () => withPayments(() => checkpointScan(...args)), 8_000);
  const undoCheckpoint = (...args: Parameters<typeof undoCheckpointUse>) =>
    mutation("undo_checkpoint", () => withPayments(() => undoCheckpointUse(...args)), 8_000);
  const fulfilTicketCheckout = (...args: Parameters<typeof fulfilCheckout>) =>
    idempotent("fulfil_checkout", () => withPayments(() => fulfilCheckout(...args)), 60_000);
  const inviteTicket = (...args: Parameters<typeof inviteAdminTicket>) =>
    mutation("invite_ticket", () => withPayments(() => inviteAdminTicket(...args)), 45_000);
  const issueComp = (...args: Parameters<typeof issueAdminComp>) =>
    mutation("issue_comp", () => withPayments(() => issueAdminComp(...args)), 45_000);
  const getDrop = (...args: Parameters<typeof getEventDrop>) =>
    eventsOperation({ domain: "event-operations", operation: "get_event_drop", kind: "read" }, () =>
      withPayments(() => getEventDrop(...args)),
    );
  const enableDrop = (...args: Parameters<typeof enableEventDrop>) =>
    mutation("enable_event_drop", () => withPayments(() => enableEventDrop(...args)));
  const disableDrop = (...args: Parameters<typeof disableEventDrop>) =>
    idempotent("disable_event_drop", () => withPayments(() => disableEventDrop(...args)));
  const resendTicketOrder = (...args: Parameters<typeof resendAdminTicketOrder>) =>
    idempotent(
      "resend_ticket_order",
      () => withPayments(() => resendAdminTicketOrder(...args)),
      45_000,
    );
  const refundOneTicket = (...args: Parameters<typeof refundTicket>) =>
    idempotent("refund_ticket", () => withPayments(() => refundTicket(...args)), 60_000);
  const refundWholeOrder = (...args: Parameters<typeof refundOrder>) =>
    idempotent("refund_order", () => withPayments(() => refundOrder(...args)), 2 * 60_000);
  const startTicketCheckout = (...args: Parameters<typeof startCheckout>) =>
    idempotent("start_checkout", () => withPayments(() => startCheckout(...args)), 60_000);
  const startExchange = (...args: Parameters<typeof beginTicketExchange>) =>
    mutation("start_exchange", () => withPayments(() => beginTicketExchange(...args)), 60_000);
  const handleStripeWebhook = (...args: Parameters<typeof handleStripeWebhookEvent>) =>
    idempotent(
      "stripe_webhook",
      () => withPayments(() => handleStripeWebhookEvent(...args)),
      2 * 60_000,
    );
  const fulfilExchange = (...args: Parameters<typeof fulfilTicketExchangeCheckout>) =>
    idempotent(
      "fulfil_exchange",
      () => withPayments(() => fulfilTicketExchangeCheckout(...args)),
      60_000,
    );
  const reconcileWaitlist = (...args: Parameters<typeof reconcileEventWaitlist>) =>
    idempotent(
      "reconcile_waitlist",
      () => withPayments(() => reconcileEventWaitlist(...args)),
      45_000,
    );
  const requestWaitlist = (...args: Parameters<typeof requestEventWaitlist>) =>
    mutation("request_waitlist", () => withPayments(() => requestEventWaitlist(...args)));
  const getWaitlist = (...args: Parameters<typeof getWaitlistManagement>) =>
    eventsOperation(
      { domain: "event-operations", operation: "get_waitlist_management", kind: "read" },
      () => withPayments(() => getWaitlistManagement(...args)),
    );
  const updateWaitlist = (...args: Parameters<typeof updateWaitlistManagement>) =>
    idempotent("update_waitlist_management", () =>
      withPayments(() => updateWaitlistManagement(...args)),
    );
  const listWaitlist = (...args: Parameters<typeof listEventWaitlist>) =>
    eventsOperation({ domain: "event-operations", operation: "list_waitlist", kind: "read" }, () =>
      withPayments(() => listEventWaitlist(...args)),
    );
  const previewWaitlist = (...args: Parameters<typeof previewWaitlistImpact>) =>
    eventsOperation(
      { domain: "event-operations", operation: "preview_waitlist", kind: "read" },
      () => withPayments(() => previewWaitlistImpact(...args)),
    );
  const resolveCheckout = (...args: Parameters<typeof resolveCheckoutOutcome>) =>
    idempotent(
      "resolve_checkout",
      () => withPayments(() => resolveCheckoutOutcome(...args)),
      60_000,
    );
  const resolveExchange = (...args: Parameters<typeof resolveTicketExchangeOutcome>) =>
    idempotent(
      "resolve_exchange",
      () => withPayments(() => resolveTicketExchangeOutcome(...args)),
      60_000,
    );

  return {
    cancellationPending,
    cancelEvent,
    claimAward,
    checkpointScan: scanCheckpoint,
    fulfilCheckout: fulfilTicketCheckout,
    fulfilExchange,
    disableDrop,
    enableDrop,
    getDrop,
    handleStripeWebhook,
    inviteTicket,
    issueComp,
    getWaitlist,
    listWaitlist,
    previewWaitlist,
    reconcileWaitlist,
    requestWaitlist,
    refundOrder: refundWholeOrder,
    refundTicket: refundOneTicket,
    resolveCheckout,
    resolveExchange,
    resendTicketOrder,
    startCheckout: startTicketCheckout,
    startExchange,
    undoCheckpointUse: undoCheckpoint,
    updateWaitlist,
  };
}

/** Strong event-night workflows; ticket/refund policy remains in the plain engines. */
export class EventOperationsService extends Context.Service<
  EventOperationsService,
  ReturnType<typeof makeEventOperations>
>()("EventOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      return makeEventOperations(yield* PaymentsService);
    }),
  );
}
