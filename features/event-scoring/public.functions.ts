import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { runEventsEffect } from "@/features/events/events-runtime.server";
import {
  activeParticipantForEvent,
  getAttendeeSession,
  openedTicketsForEvent,
} from "./session.server";
import { getTicket } from "@/features/tickets/store.server";
import { ticketPublicId } from "@/features/tickets/types";
import { getParticipant } from "./store.server";
import { EventScoringService } from "./event-scoring-service.server";

function runScoring<A, E>(
  use: (service: typeof EventScoringService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* EventScoringService);
    }),
    getRequest().signal,
  );
}

async function openedTicketChoices(eventSlug: string, activeParticipantId?: string) {
  const opened = await openedTicketsForEvent(eventSlug);
  return Promise.all(
    opened.map(async (access) => {
      const [ticket, participant] = await Promise.all([
        getTicket(access.ticketId),
        getParticipant(access.participantId),
      ]);
      return {
        ticketId: ticket ? ticketPublicId(ticket) : access.ticketId,
        participantId: access.participantId,
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
  .handler(async ({ data }) => {
    const currentParticipantId = await activeParticipantForEvent(data.eventSlug);
    return runScoring((scoring) =>
      scoring.publicLeaderboard({
        eventSlug: data.eventSlug,
        currentParticipantId,
        includePreview: false,
      }),
    );
  });

export const getPublicDiscoveryFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown; discoveryId?: unknown } | null;
    return {
      eventSlug: identifier(input?.eventSlug, "Event"),
      discoveryId: identifier(input?.discoveryId, "Discovery"),
    };
  })
  .handler(async ({ data }) => {
    const discovery = await runScoring((scoring) => scoring.getDiscovery(data.discoveryId));
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
    const preview = await runScoring((scoring) =>
      scoring.getStaffAwardPreview(data.eventSlug, data.token),
    );
    if (!preview) return null;
    const activeParticipantId = await activeParticipantForEvent(data.eventSlug);
    return {
      preview,
      activeParticipantId,
      tickets: await openedTicketChoices(data.eventSlug, activeParticipantId),
    };
  });
