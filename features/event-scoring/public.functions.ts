import { createServerFn } from "@tanstack/react-start";

import { getDiscovery } from "./discoveries.server";
import { publicLeaderboard } from "./scoring.server";
import {
  activeParticipantForEvent,
  getAttendeeSession,
  openedTicketsForEvent,
} from "./session.server";
import { getTicket } from "@/features/tickets/store.server";
import { getStaffAwardClaimPreview } from "./staff-award-claims.server";
import { getParticipant } from "./store.server";

async function openedTicketChoices(eventSlug: string, activeParticipantId?: string) {
  const opened = await openedTicketsForEvent(eventSlug);
  return Promise.all(
    opened.map(async (access) => {
      const [ticket, participant] = await Promise.all([
        getTicket(access.ticketId),
        getParticipant(access.participantId),
      ]);
      return {
        ticketId: access.ticketId,
        holderName: ticket?.holderName ?? "Event ticket",
        active: access.participantId === activeParticipantId,
        checkedIn: Boolean(participant?.checkedInAt),
      };
    }),
  );
}

export const getClaimedScoreLinksFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  if (!session) return [];
  const seen = new Set<string>();
  return session.tickets
    .filter((ticket) => ticket.mode === "scoring")
    .flatMap((ticket) => {
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
    const activeParticipantId = await activeParticipantForEvent(data.eventSlug);
    return {
      discovery,
      activeParticipantId,
      tickets: await openedTicketChoices(data.eventSlug, activeParticipantId),
    };
  });

export const getDiscoveryClaimPageFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown } | null;
    return { eventSlug: identifier(input?.eventSlug, "Event") };
  })
  .handler(async ({ data }) => {
    const activeParticipantId = await activeParticipantForEvent(data.eventSlug);
    return {
      activeParticipantId,
      tickets: await openedTicketChoices(data.eventSlug, activeParticipantId),
    };
  });

export const getPublicStaffAwardClaimFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown; token?: unknown } | null;
    return {
      eventSlug: identifier(input?.eventSlug, "Event"),
      token: identifier(input?.token, "Award"),
    };
  })
  .handler(async ({ data }) => {
    const preview = await getStaffAwardClaimPreview(data.eventSlug, data.token);
    if (!preview) return null;
    const activeParticipantId = await activeParticipantForEvent(data.eventSlug);
    return {
      preview,
      activeParticipantId,
      tickets: await openedTicketChoices(data.eventSlug, activeParticipantId),
    };
  });
