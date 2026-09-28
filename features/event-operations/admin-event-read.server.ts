import { Effect } from "effect";
import { EventsService } from "@/features/events/events-service.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import { runEventsResult } from "@/features/events/events-runtime.server";

export function readAdminEventOperations(slug: string, signal?: AbortSignal) {
  return runEventsResult(
    Effect.gen(function* () {
      const events = yield* EventsService;
      const tickets = yield* TicketsService;
      const event = yield* events.read(slug);
      if (!event) return { event: null, tickets: null };
      return { event, tickets: yield* tickets.forEvent(slug) };
    }),
    signal,
  );
}
