import { getEvent } from "@/features/events/store.server";
import {
  activeParticipantForEvent,
  getAttendeeSession,
  openedTicketsForEvent,
} from "@/features/event-scoring/session.server";
import {
  findSettings,
  getParticipant,
  ticketParticipantsForPerson,
} from "@/features/event-scoring/store.server";
import { getTicket } from "@/features/tickets/store.server";
import { ticketPublicId } from "@/features/tickets/types";
import type { EventNightContext } from "./event-night.types";

export async function eventNightContexts(): Promise<EventNightContext[]> {
  const session = await getAttendeeSession();
  if (!session) return [];

  const recovered = session.personId ? await ticketParticipantsForPerson(session.personId) : [];
  const eventSlugs = [
    ...new Set([
      ...session.tickets.map((ticket) => ticket.eventSlug),
      ...recovered.map((p) => p.eventSlug),
    ]),
  ];
  const contexts = await Promise.all(
    eventSlugs.map(async (eventSlug): Promise<EventNightContext | null> => {
      const [opened, activeParticipantId, event, settings] = await Promise.all([
        openedTicketsForEvent(eventSlug),
        activeParticipantForEvent(eventSlug),
        getEvent(eventSlug),
        findSettings(eventSlug),
      ]);
      if (!event) return null;

      const recoveredForEvent = recovered.filter(
        (participant) => participant.eventSlug === eventSlug,
      );
      const selectedAccess = activeParticipantId
        ? opened.find((access) => access.participantId === activeParticipantId)
        : undefined;
      const selectedRecovered = activeParticipantId
        ? recoveredForEvent.find((participant) => participant.id === activeParticipantId)
        : undefined;
      const fallbackAccess = opened.at(-1);
      const fallbackRecovered = recoveredForEvent[0];
      const participantId =
        selectedAccess?.participantId ??
        selectedRecovered?.id ??
        fallbackAccess?.participantId ??
        fallbackRecovered?.id;
      const ticketId =
        selectedAccess?.ticketId ??
        selectedRecovered?.ticketId ??
        fallbackAccess?.ticketId ??
        fallbackRecovered?.ticketId;
      if (!participantId || !ticketId) return null;

      const [participant, ticket] = await Promise.all([
        getParticipant(participantId),
        getTicket(ticketId),
      ]);
      if (!participant || !ticket || ticket.status !== "valid") return null;
      const selectedAt =
        selectedAccess?.addedAt ??
        fallbackAccess?.addedAt ??
        participant.lastTransactionAt ??
        ticket.issuedAt;
      return {
        eventSlug,
        eventTitle: event.title,
        eventStatus: event.status,
        startsAt: event.startsAt,
        doorsAt: event.doorsAt,
        endsAt: event.endsAt,
        ticketId: ticketPublicId(ticket),
        participantId,
        holderName: ticket.holderName,
        active: activeParticipantId === participantId,
        checkedIn: Boolean(participant.checkedInAt),
        savedToAccount: Boolean(session.personId && participant.personId === session.personId),
        points: participant.balance,
        revision: participant.revision,
        scoringState: settings?.state ?? "off",
        lastConfirmedAt: participant.lastTransactionAt,
        selectedAt,
      };
    }),
  );
  return contexts
    .filter((context): context is EventNightContext => Boolean(context))
    .sort((left, right) => Date.parse(left.selectedAt) - Date.parse(right.selectedAt));
}
