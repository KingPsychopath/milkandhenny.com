import { createAdminTicketInvitation } from "@/features/attendee-operations/ticket-operations.server";
import { getEvent } from "@/features/events/store.server";
import { sendTicketEmail } from "@/features/tickets/email.server";
import { listTicketsForOrder } from "@/features/tickets/store.server";
import {
  getTicket,
  issueTickets,
  voidTicket,
  type IssueTicketsInput,
  type TicketOpResult,
} from "@/features/tickets/tickets.server";

type AdminActor = {
  actorId: string;
  actorType: "admin" | "root-owner";
};

export async function inviteAdminTicket(
  input: AdminActor & {
    eventSlug: string;
    holderName: string;
    email: string;
    ticketTypeId: string;
    bypassCapacity: boolean;
    origin: string;
  },
): Promise<
  TicketOpResult<{
    ticketId: string;
    invitationId: string;
    expiresAt: string;
    emailQueued: boolean;
  }>
> {
  const issued = await issueTickets({
    eventSlug: input.eventSlug,
    ticketTypeId: input.ticketTypeId,
    holderName: input.holderName,
    email: input.email,
    quantity: 1,
    kind: "comp",
    bypassSalesWindow: true,
    bypassCapacity: input.bypassCapacity,
  });
  if (!issued.ok) return issued;
  const ticket = issued.value.tickets[0];
  const invitation = await createAdminTicketInvitation({
    eventSlug: input.eventSlug,
    ticketId: ticket.id,
    recipientEmail: input.email,
    actorType: input.actorType,
    actorId: input.actorId,
    origin: input.origin,
  });
  if (!invitation.ok) {
    await voidTicket(ticket.id);
    return invitation;
  }
  return { ok: true, value: { ticketId: ticket.id, ...invitation.value } };
}

export async function issueAdminComp(input: {
  issue: IssueTicketsInput;
  notify: boolean;
  origin: string;
}): Promise<TicketOpResult<{ ticketIds: string[]; emailQueued: boolean }>> {
  const issued = await issueTickets(input.issue);
  if (!issued.ok) return issued;
  let emailQueued = false;
  if (input.notify && issued.value.tickets.some(({ email }) => email)) {
    const delivery = await sendTicketEmail({
      event: issued.value.event,
      tickets: issued.value.tickets,
      origin: input.origin,
      idempotencyKey: `tickets:issued:${issued.value.orderId}`,
      kind: "ticket-issued",
      source: "admin",
    });
    emailQueued = delivery.queued;
  }
  return {
    ok: true,
    value: { ticketIds: issued.value.tickets.map(({ id }) => id), emailQueued },
  };
}

export async function resendAdminTicketOrder(input: {
  eventSlug: string;
  ticketId: string;
  origin: string;
}): Promise<TicketOpResult<{ queued: number; alreadyRequested: boolean }>> {
  const ticket = await getTicket(input.ticketId);
  if (!ticket || ticket.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Ticket not found" };
  }
  const [event, orderTickets] = await Promise.all([
    getEvent(input.eventSlug),
    listTicketsForOrder(ticket.orderId),
  ]);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  const live = orderTickets.filter(({ status }) => status === "valid");
  if (live.length === 0) {
    return { ok: false, status: 409, error: "No live tickets on this order" };
  }
  const delivery = await sendTicketEmail({
    event,
    tickets: live,
    origin: input.origin,
    idempotencyKey: `tickets:admin-resend:${ticket.orderId}:${Math.floor(Date.now() / 60_000)}`,
    kind: "ticket-resend",
    source: "admin",
  });
  if (!delivery.queued) {
    return { ok: false, status: 502, error: delivery.error ?? "Email failed to send" };
  }
  return {
    ok: true,
    value: {
      queued: delivery.alreadyRequested ? 0 : live.length,
      alreadyRequested: delivery.alreadyRequested === true,
    },
  };
}
