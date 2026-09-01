import { Context, Effect, Layer } from "effect";

import { cleanupExpiredAccessChallenges } from "@/features/attendee-access/access.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { acceptAccessAction, inviteNamedAdmin, revokeNamedAdmin } from "./access-grants.server";
import { revokeAlertRecipient, saveAlertRecipient, sendTestAlert } from "./notifications.server";
import {
  acceptRefundConsent,
  acceptTicketAction,
  cancelAdminTicketInvitation,
  cancelPendingTicketOperation,
  cancelTransferredTicketReturn,
  createAdminTicketInvitation,
  declineRefundConsent,
  declineTicketTransfer,
  expireTicketOperations,
  requestTicketAssignment,
  requestTicketTransfer,
  requestTransferredTicketReturn,
  resendAdminTicketInvitation,
  resendPendingTicketOperation,
} from "./ticket-operations.server";

function operation<A>(name: string, run: (signal: AbortSignal) => Promise<A>, timeoutMs = 45_000) {
  return eventsOperation(
    {
      domain: "attendee-operations",
      operation: name,
      kind: "idempotent-mutation",
      timeoutMs,
    },
    run,
  );
}

const mutate =
  <Args extends unknown[], Result>(
    name: string,
    run: (...args: Args) => Promise<Result>,
    timeoutMs?: number,
  ) =>
  (...args: Args) =>
    operation(name, () => run(...args), timeoutMs);

const inviteAdmin = mutate("invite_admin", inviteNamedAdmin);
const revokeAdmin = mutate("revoke_admin", revokeNamedAdmin);
const acceptAccess = mutate("accept_access", acceptAccessAction);
const saveAlerts = mutate("save_alert_recipient", saveAlertRecipient);
const revokeAlerts = mutate("revoke_alert_recipient", revokeAlertRecipient);
const testAlert = mutate("send_test_alert", sendTestAlert);
const requestAssignment = mutate("request_assignment", requestTicketAssignment);
const requestTransfer = mutate("request_transfer", requestTicketTransfer);
const requestReturn = mutate("request_return", requestTransferredTicketReturn);
const createInvitation = mutate("create_invitation", createAdminTicketInvitation);
const cancelInvitation = mutate("cancel_invitation", cancelAdminTicketInvitation);
const resendInvitation = mutate("resend_invitation", resendAdminTicketInvitation);
const acceptRefund = mutate("accept_refund", acceptRefundConsent, 2 * 60_000);
const declineRefund = mutate("decline_refund", declineRefundConsent);
const acceptTicket = mutate("accept_ticket", acceptTicketAction);
const declineTransfer = mutate("decline_transfer", declineTicketTransfer);
const cancelPending = mutate("cancel_pending", cancelPendingTicketOperation);
const cancelReturn = mutate("cancel_return", cancelTransferredTicketReturn);
const resendPending = mutate("resend_pending", resendPendingTicketOperation);

const cleanupExpired = Effect.all(
  [
    operation("cleanup_access", () => cleanupExpiredAccessChallenges()),
    operation("cleanup_ticket_operations", () => expireTicketOperations()),
  ],
  { concurrency: 2 },
).pipe(Effect.map(([access, ticketOperations]) => ({ access, ticketOperations })));

/**
 * Cross-provider attendee workflows. Identity, authorization, transfer, and refund policy remain
 * in the plain engines; Effect owns deadlines, cancellation, telemetry, and failure typing.
 */
export class AttendeeOperationsService extends Context.Service<
  AttendeeOperationsService,
  {
    readonly acceptAccess: typeof acceptAccess;
    readonly acceptRefund: typeof acceptRefund;
    readonly acceptTicket: typeof acceptTicket;
    readonly cancelInvitation: typeof cancelInvitation;
    readonly cancelPending: typeof cancelPending;
    readonly cancelReturn: typeof cancelReturn;
    readonly cleanupExpired: typeof cleanupExpired;
    readonly createInvitation: typeof createInvitation;
    readonly declineRefund: typeof declineRefund;
    readonly declineTransfer: typeof declineTransfer;
    readonly inviteAdmin: typeof inviteAdmin;
    readonly requestAssignment: typeof requestAssignment;
    readonly requestReturn: typeof requestReturn;
    readonly requestTransfer: typeof requestTransfer;
    readonly resendInvitation: typeof resendInvitation;
    readonly resendPending: typeof resendPending;
    readonly revokeAdmin: typeof revokeAdmin;
    readonly revokeAlerts: typeof revokeAlerts;
    readonly saveAlerts: typeof saveAlerts;
    readonly testAlert: typeof testAlert;
  }
>()("AttendeeOperationsService") {
  static readonly layer = Layer.succeed(this, {
    acceptAccess,
    acceptRefund,
    acceptTicket,
    cancelInvitation,
    cancelPending,
    cancelReturn,
    cleanupExpired,
    createInvitation,
    declineRefund,
    declineTransfer,
    inviteAdmin,
    requestAssignment,
    requestReturn,
    requestTransfer,
    resendInvitation,
    resendPending,
    revokeAdmin,
    revokeAlerts,
    saveAlerts,
    testAlert,
  });
}
