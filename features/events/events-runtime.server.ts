import { Effect, Layer } from "effect";

import { runEffectResult, type EffectRunResult } from "@/lib/platform/effect-boundary.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
import {
  EmailProviderService,
  PaymentsService,
  PostgresService,
  RedisService,
} from "@/lib/platform/provider-services.server";
import { AttendeeOperationsService } from "@/features/attendee-operations/attendee-operations-service.server";
import { CommunicationsService } from "@/features/communications/communications-service.server";
import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { EventIcebreakerService } from "@/features/event-icebreaker/event-icebreaker-service.server";
import { StaffAccessService } from "@/features/event-scoring/staff-access-service.server";
import { ApplicationSchedulerService } from "@/features/system/application-scheduler-service.server";
import { TicketsService } from "@/features/tickets/tickets-service.server";
import { EventsRealtimeService } from "./events-resources.server";
import { EventsService } from "./events-service.server";

/**
 * Managed runtime for the events subsystem.
 *
 * Built lazily once per Node process and disposed by a Nitro shutdown hook,
 * the same lifecycle the multiplayer runtime uses. It owns no authoritative
 * state — Postgres, Redis, and durable outboxes remain authoritative, so any
 * replica can serve the next request.
 */
const eventWorkflowLayer = Layer.mergeAll(
  CommunicationsService.layer.pipe(Layer.provide(EmailProviderService.layer)),
  EventScoringService.layer,
);
const scheduledEventWorkflowLayer = ApplicationSchedulerService.layer.pipe(
  Layer.provide(Layer.mergeAll(eventWorkflowLayer, PostgresService.layer, RedisService.layer)),
);
const eventsLayer = Layer.mergeAll(
  eventWorkflowLayer,
  EventsService.layer,
  TicketsService.layer,
  AttendeeOperationsService.layer,
  EventOperationsService.layer.pipe(Layer.provide(PaymentsService.layer)),
  EventIcebreakerService.layer.pipe(Layer.provide(PostgresService.layer)),
  StaffAccessService.layer,
  scheduledEventWorkflowLayer,
  EventsRealtimeService.layer.pipe(Layer.provide(PostgresService.layer)),
);

const eventsRuntime = makeManagedRuntimeHost(eventsLayer, "Events");

export type EventsServices =
  | ApplicationSchedulerService
  | AttendeeOperationsService
  | CommunicationsService
  | EventOperationsService
  | EventIcebreakerService
  | EventScoringService
  | EventsRealtimeService
  | StaffAccessService
  | EventsService
  | TicketsService;

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
