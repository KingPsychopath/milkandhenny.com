import { createServerFn } from "@tanstack/react-start";

import { getDiscovery } from "./discoveries.server";
import { publicLeaderboard } from "./scoring.server";
import {
  activeParticipantForEvent,
  getAttendeeSession,
  openedTicketsForEvent,
} from "./session.server";
import { getTicket } from "@/features/tickets/store.server";

async function openedTicketChoices(eventSlug: string) {
  const opened = await openedTicketsForEvent(eventSlug);
  return Promise.all(
    opened.map(async (access) => ({
      ticketId: access.ticketId,
      holderName: (await getTicket(access.ticketId))?.holderName ?? "Event ticket",
    })),
  );
}

export const getClaimedScoreLinksFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  if (!session) return [];
  const seen = new Set<string>();
  return session.tickets.flatMap((ticket) => {
    if (seen.has(ticket.eventSlug)) return [];
    seen.add(ticket.eventSlug);
    return [{ eventSlug: ticket.eventSlug, ticketId: ticket.ticketId }];
  });
});

function identifier(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const result = value.trim();
  if (!result || result.length > 160) throw new Error(`${label} is invalid`);
  return result;
}

export const getPublicLeaderboardFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown } | null;
    return { eventSlug: identifier(input?.eventSlug, "Event") };
  })
  .handler(async ({ data }) =>
    publicLeaderboard({
      eventSlug: data.eventSlug,
      currentParticipantId: await activeParticipantForEvent(data.eventSlug),
      includePreview: false,
    }),
  );

export const getPublicDiscoveryFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown; discoveryId?: unknown } | null;
    return {
      eventSlug: identifier(input?.eventSlug, "Event"),
      discoveryId: identifier(input?.discoveryId, "Discovery"),
    };
  })
  .handler(async ({ data }) => {
    const discovery = await getDiscovery(data.discoveryId);
    if (!discovery || discovery.eventSlug !== data.eventSlug) return null;
    return {
      discovery,
      activeParticipantId: await activeParticipantForEvent(data.eventSlug),
      tickets: await openedTicketChoices(data.eventSlug),
    };
  });

export const getDiscoveryClaimPageFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown } | null;
    return { eventSlug: identifier(input?.eventSlug, "Event") };
  })
  .handler(async ({ data }) => ({
    activeParticipantId: await activeParticipantForEvent(data.eventSlug),
    tickets: await openedTicketChoices(data.eventSlug),
  }));
