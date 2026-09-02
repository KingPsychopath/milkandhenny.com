import { Effect } from "effect";

import { runEventsEffect } from "@/features/events/events-runtime.server";
import { ApplicationSchedulerService } from "./application-scheduler-service.server";

function withScheduler<A, E>(
  use: (scheduler: typeof ApplicationSchedulerService.Service) => Effect.Effect<A, E>,
  signal?: AbortSignal,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* ApplicationSchedulerService);
    }),
    signal,
  );
}

export function runEmailDeliveryScheduledJob(force = false, signal?: AbortSignal) {
  return withScheduler((scheduler) => scheduler.runCommunications(force), signal);
}

export function runEventDropsScheduledJob(force = false, signal?: AbortSignal) {
  return withScheduler((scheduler) => scheduler.runEventDrops(force), signal);
}

export function runPitchReminderScheduledJob(force = false, signal?: AbortSignal) {
  return withScheduler((scheduler) => scheduler.runPitchReminders(force), signal);
}

export function runOperationsDigestScheduledJob(force = false, signal?: AbortSignal) {
  return withScheduler((scheduler) => scheduler.runOperationsDigests(force), signal);
}

export function runGamePoolCleanupScheduledJob(force = false, signal?: AbortSignal) {
  return withScheduler((scheduler) => scheduler.runGamePoolCleanup(force), signal);
}

export function startApplicationScheduler(): Promise<void> {
  return withScheduler((scheduler) => scheduler.start);
}

export function stopApplicationScheduler(): Promise<void> {
  return withScheduler((scheduler) => scheduler.stop).catch((error: unknown) => {
    if (error instanceof Error && /dispos(?:ed|ing)/i.test(error.message)) return;
    throw error;
  });
}
