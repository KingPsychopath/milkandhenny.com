import { createServerFn } from "@tanstack/react-start";

import { acceptAccessAction, inspectAccessAction } from "./access-grants.server";
import {
  acceptRefundConsent,
  acceptTicketAction,
  declineRefundConsent,
  declineTicketTransfer,
  inspectTicketAction,
} from "./ticket-operations.server";

export const readAttendeeActionFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const ticket = await inspectTicketAction(data.token);
    if (ticket) return { kind: "ticket" as const, ...ticket };
    const access = await inspectAccessAction(data.token);
    return access ? { kind: "access" as const, ...access } : null;
  });

export const acceptAttendeeActionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const access = await inspectAccessAction(data.token);
    if (access) return acceptAccessAction(data.token);
    const ticket = await inspectTicketAction(data.token);
    return ticket?.purpose === "refund-consent" || ticket?.purpose === "ticket-return"
      ? acceptRefundConsent(data.token)
      : acceptTicketAction(data.token);
  });

export const declineAttendeeActionFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const ticket = await inspectTicketAction(data.token);
    return ticket?.purpose === "refund-consent" || ticket?.purpose === "ticket-return"
      ? declineRefundConsent(data.token)
      : declineTicketTransfer(data.token);
  });
