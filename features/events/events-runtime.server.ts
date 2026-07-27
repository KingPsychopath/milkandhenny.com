import { Effect, Layer, ManagedRuntime } from "effect";

import { TicketsService } from "@/features/tickets/tickets-service.server";
import { EventsService } from "./events-service.server";

/**
 * Managed runtime for the events subsystem.
 *
 * Built lazily once per Node process and disposed by a Nitro shutdown hook,
 * the same lifecycle the multiplayer runtime uses. It owns no authoritative
 * state — Redis remains the source of truth, so any replica can serve the
 * next request.
 */
const eventsLayer = Layer.mergeAll(EventsService.layer, TicketsService.layer);

const eventsRuntime = ManagedRuntime.make(eventsLayer);

export type EventsServices = EventsService | TicketsService;

/** The only sanctioned Promise boundary — call this from TanStack/Nitro edges. */
export function runEventsEffect<A, E>(
  effect: Effect.Effect<A, E, EventsServices>,
  signal?: AbortSignal,
) {
  return eventsRuntime.runPromise(effect, signal ? { signal } : undefined);
}

export function disposeEventsRuntime() {
  return eventsRuntime.dispose();
}

export type EventsRunResult<A> =
  | { ok: true; value: A }
  | { ok: false; status: number; error: string; retryable: boolean };

/**
 * Run an effect and flatten its failure into a transport-shaped result.
 *
 * Server functions and API routes are the boundary where an Effect failure
 * has to become an HTTP-ish answer; keeping that translation in one place
 * stops each caller inventing its own status codes.
 */
export async function runEventsResult<A, E>(
  effect: Effect.Effect<A, E, EventsServices>,
  signal?: AbortSignal,
): Promise<EventsRunResult<A>> {
  try {
    return { ok: true, value: await runEventsEffect(effect, signal) };
  } catch (error) {
    const retryable =
      typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { retryable: unknown }).retryable === true;
    return {
      ok: false,
      status: retryable ? 503 : 500,
      error: retryable ? "That took too long. Try again." : "Something went wrong.",
      retryable,
    };
  }
}
