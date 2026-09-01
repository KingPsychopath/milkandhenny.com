import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";

import {
  activeParticipantForEvent,
  openedTicketForReference,
  openedTicketsForEvent,
} from "@/features/event-scoring/session.server";
import { getTicket } from "@/features/tickets/store.server";
import { ticketPublicId } from "@/features/tickets/types";
import { isPlayerId } from "@/features/things/icebreaker/icebreaker-pairing";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { EventIcebreakerService } from "./event-icebreaker-service.server";

function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const clean = value.trim();
  if (!clean || clean.length > max) throw new Error(`${label} is invalid`);
  return clean;
}

async function resolveAccess(eventSlug: string, ticketReference?: string) {
  if (ticketReference) {
    const access = await openedTicketForReference(ticketReference);
    if (access?.eventSlug === eventSlug) return access;
    return null;
  }
  const activeParticipantId = await activeParticipantForEvent(eventSlug);
  const opened = await openedTicketsForEvent(eventSlug);
  if (activeParticipantId) {
    return opened.find((entry) => entry.participantId === activeParticipantId) ?? null;
  }
  return opened.length === 1 ? opened[0] : null;
}

export const getEventIcebreakerFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown; ticketReference?: unknown } | null;
    return {
      eventSlug: text(input?.eventSlug, "Event", 80),
      ticketReference:
        typeof input?.ticketReference === "string" && input.ticketReference.trim()
          ? text(input.ticketReference, "Ticket", 160)
          : undefined,
    };
  })
  .handler(async ({ data }) => {
    const request = getRequest();
    const access = await resolveAccess(data.eventSlug, data.ticketReference);
    if (!access) {
      return { ok: false as const, status: 404, error: "Open your event ticket on this device" };
    }
    const [result, ticket] = await Promise.all([
      runEventsEffect(
        Effect.gen(function* () {
          return yield* (yield* EventIcebreakerService).get(data.eventSlug, access.participantId);
        }),
        request.signal,
      ),
      getTicket(access.ticketId),
    ]);
    if (!result.ok) return result;
    if (!ticket) return { ok: false as const, status: 404, error: "Event ticket not found" };
    return {
      ok: true as const,
      value: {
        ...result.value,
        ticketReference: ticketPublicId(ticket),
      },
    };
  });

export const addEventIcebreakerEncounterFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const input = value as {
      eventSlug?: unknown;
      ticketReference?: unknown;
      partnerCode?: unknown;
    } | null;
    const partnerCode = text(input?.partnerCode, "Pairing code", 5).toUpperCase();
    if (!isPlayerId(partnerCode)) throw new Error("Pairing code is invalid");
    return {
      eventSlug: text(input?.eventSlug, "Event", 80),
      ticketReference:
        typeof input?.ticketReference === "string" && input.ticketReference.trim()
          ? text(input.ticketReference, "Ticket", 160)
          : undefined,
      partnerCode,
    };
  })
  .handler(async ({ data }) => {
    const request = getRequest();
    const access = await resolveAccess(data.eventSlug, data.ticketReference);
    if (!access) {
      return { ok: false as const, status: 404, error: "Open your event ticket on this device" };
    }
    return runEventsEffect(
      Effect.gen(function* () {
        return yield* (yield* EventIcebreakerService).encounter({
          eventSlug: data.eventSlug,
          participantId: access.participantId,
          partnerCode: data.partnerCode,
        });
      }),
      request.signal,
    );
  });
