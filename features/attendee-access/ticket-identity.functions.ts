import { createServerFn } from "@tanstack/react-start";

import {
  getAttendeeSession,
  openedTicketForReference,
} from "@/features/attendee-access/session.server";
import { getTicketByCurrentReference } from "@/features/tickets/store.server";
import { claimTicketForPerson } from "./access.server";

export const claimTicketIdentityFn = createServerFn({ method: "POST" })
  .validator((data: { ticketId: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    if (!session?.personId || !session.verifiedEmailHash) {
      return { ok: false as const, status: 401, error: "Verify your email first" };
    }
    const ticket = await getTicketByCurrentReference(data.ticketId);
    const access = await openedTicketForReference(data.ticketId);
    if (!access) {
      return {
        ok: false as const,
        status: 403,
        error: "Open this ticket on this device first",
      };
    }
    return claimTicketForPerson({
      personId: session.personId,
      verifiedEmailHash: session.verifiedEmailHash,
      ticketId: ticket?.id ?? data.ticketId,
      permittedParticipantId: access.participantId,
    });
  });
