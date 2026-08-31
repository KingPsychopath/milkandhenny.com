import { Effect, Layer } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
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

const eventsRuntime = makeManagedRuntimeHost(eventsLayer, "Events");

export type EventsServices = EventsService | TicketsService;

/** The only sanctioned Promise boundary — call this from TanStack/Nitro edges. */
export function runEventsEffect<A, E>(
  effect: Effect.Effect<A, E, EventsServices>,
  signal?: AbortSignal,
) {
  return eventsRuntime.run(effect, signal);
}

export function disposeEventsRuntime() {
  return eventsRuntime.dispose();
}

export type EventsRunResult<A> = EffectRunResult<A>;

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
  return runEffectResult(() => runEventsEffect(effect, signal));
}
