import { Effect, Layer, ManagedRuntime } from "effect";

import { EventsService } from "@/features/events/events-service.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";

const eventOperationsLayer = Layer.mergeAll(EventsService.layer, TicketsService.layer);
const eventOperationsRuntime = ManagedRuntime.make(eventOperationsLayer);

export type EventOperationsServices = EventsService | TicketsService;

export function runEventOperationsEffect<A, E>(
  effect: Effect.Effect<A, E, EventOperationsServices>,
  signal?: AbortSignal,
) {
  return eventOperationsRuntime.runPromise(effect, signal ? { signal } : undefined);
}

export type EventOperationsResult<A> =
  | { ok: true; value: A }
  | { ok: false; status: number; error: string; retryable: boolean };

export async function runEventOperationsResult<A, E>(
  effect: Effect.Effect<A, E, EventOperationsServices>,
  signal?: AbortSignal,
): Promise<EventOperationsResult<A>> {
  try {
    return { ok: true, value: await runEventOperationsEffect(effect, signal) };
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

export function disposeEventOperationsRuntime() {
  return eventOperationsRuntime.dispose();
}
