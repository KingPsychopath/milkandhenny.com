import { Effect } from "effect";

import { sendOperationsDigests } from "@/features/attendee-operations/notifications.server";
import { expandDueCommunicationStages } from "@/features/communications/communication-plans.server";
import {
  consumeOfficialGameResult,
  processPendingOfficialGameResults,
} from "@/features/event-scoring/games.server";
import { processScheduledScoringTransitions } from "@/features/event-scoring/scoring.server";
import { drainOfficialGameResultOutbox } from "@/features/game-results/outbox.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { drainEmailOutbox } from "@/lib/platform/email-outbox.server";
import { log } from "@/lib/platform/logger.server";
import { runLeasedScheduledJob, type ScheduledJobRun } from "@/lib/platform/scheduled-jobs.server";
import { BASE_URL } from "@/lib/shared/config";
import { isMediaWorkerRole } from "./media-role.server";

const EMAIL_INTERVAL_MS = 15_000;
const EVENT_SCORING_INTERVAL_MS = 30_000;
const OPERATIONS_DIGEST_INTERVAL_MS = 5 * 60_000;
const PITCH_REMINDER_INTERVAL_MS = 15 * 60_000;
const JOB_LEASE_MS = 10 * 60_000;

interface ScheduledJobDefinition {
  jobKey: string;
  intervalMs: number;
  run: () => Promise<void>;
}

function schedulerDisabled(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.APP_SCHEDULER_DISABLED ?? "").trim().toLowerCase(),
  );
}

export async function runEmailDeliveryScheduledJob(
  force = false,
): Promise<ScheduledJobRun<{ staged: number; handled: number }>> {
  return runLeasedScheduledJob({
    jobKey: "communications-delivery",
    intervalMs: EMAIL_INTERVAL_MS,
    retryMs: EMAIL_INTERVAL_MS,
    leaseMs: JOB_LEASE_MS,
    force,
    run: async () => {
      const staged = await expandDueCommunicationStages();
      const handled = await drainEmailOutbox();
      return { staged, handled };
    },
  });
}

export async function runEventScoringScheduledJob(force = false) {
  return runLeasedScheduledJob({
    jobKey: "event-scoring",
    intervalMs: EVENT_SCORING_INTERVAL_MS,
    retryMs: EVENT_SCORING_INTERVAL_MS,
    leaseMs: JOB_LEASE_MS,
    force,
    run: async () => {
      const [outbox, result, scoringTransitions] = await Promise.all([
        drainOfficialGameResultOutbox(consumeOfficialGameResult),
        processPendingOfficialGameResults(),
        processScheduledScoringTransitions(),
      ]);
      return { outbox, result, scoringTransitions };
    },
  });
}

export async function runPitchReminderScheduledJob(force = false) {
  return runLeasedScheduledJob({
    jobKey: "pitch-reminders",
    intervalMs: PITCH_REMINDER_INTERVAL_MS,
    retryMs: PITCH_REMINDER_INTERVAL_MS,
    leaseMs: JOB_LEASE_MS,
    force,
    run: async () => {
      const outcome = await runPitchesResult(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.runAutomaticReminders({ origin: BASE_URL });
        }),
      );
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.value;
    },
  });
}

export async function runOperationsDigestScheduledJob(force = false) {
  return runLeasedScheduledJob({
    jobKey: "operations-digests",
    intervalMs: OPERATIONS_DIGEST_INTERVAL_MS,
    retryMs: OPERATIONS_DIGEST_INTERVAL_MS,
    leaseMs: JOB_LEASE_MS,
    force,
    run: () => sendOperationsDigests(),
  });
}

const JOBS: readonly ScheduledJobDefinition[] = [
  {
    jobKey: "communications-delivery",
    intervalMs: EMAIL_INTERVAL_MS,
    run: async () => {
      const outcome = await runEmailDeliveryScheduledJob();
      if (outcome.ran && (outcome.value.staged > 0 || outcome.value.handled > 0)) {
        log.info("scheduler.communications", "Scheduled email work completed", outcome.value);
      }
    },
  },
  {
    jobKey: "event-scoring",
    intervalMs: EVENT_SCORING_INTERVAL_MS,
    run: async () => {
      const outcome = await runEventScoringScheduledJob();
      if (
        outcome.ran &&
        (outcome.value.result.selected > 0 || outcome.value.scoringTransitions > 0)
      ) {
        log.info("scheduler.event-scoring", "Scheduled scoring work completed", {
          ...outcome.value.result,
          scoringTransitions: outcome.value.scoringTransitions,
        });
      }
    },
  },
  {
    jobKey: "operations-digests",
    intervalMs: OPERATIONS_DIGEST_INTERVAL_MS,
    run: async () => {
      const outcome = await runOperationsDigestScheduledJob();
      if (outcome.ran && outcome.value.queued > 0) {
        log.info("scheduler.operations-digests", "Operations digests queued", outcome.value);
      }
    },
  },
  {
    jobKey: "pitch-reminders",
    intervalMs: PITCH_REMINDER_INTERVAL_MS,
    run: async () => {
      const outcome = await runPitchReminderScheduledJob();
      if (outcome.ran && (outcome.value.queuedEmails > 0 || outcome.value.failedDecks > 0)) {
        log.info("scheduler.pitch-reminders", "Pitch reminder work completed", {
          queuedEmails: outcome.value.queuedEmails,
          sentDecks: outcome.value.sentDecks,
          failedDecks: outcome.value.failedDecks,
          automatic: outcome.value.automatic,
        });
      }
    },
  },
];

let schedulerRunning = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const activeRuns = new Set<Promise<void>>();

function schedule(job: ScheduledJobDefinition, delayMs: number): void {
  if (!schedulerRunning || timers.has(job.jobKey)) return;
  const timer = setTimeout(() => {
    timers.delete(job.jobKey);
    if (!schedulerRunning) return;
    const active = job
      .run()
      .catch((error: unknown) => {
        log.error(
          "scheduler.job",
          "Application scheduled job failed",
          { jobKey: job.jobKey },
          error,
        );
      })
      .finally(() => {
        activeRuns.delete(active);
        schedule(job, job.intervalMs + 250);
      });
    activeRuns.add(active);
  }, delayMs);
  timer.unref();
  timers.set(job.jobKey, timer);
}

export function startApplicationScheduler(): void {
  if (schedulerRunning || schedulerDisabled() || isMediaWorkerRole()) return;
  schedulerRunning = true;
  JOBS.forEach((job, index) => schedule(job, index * 250));
  log.info("scheduler", "Application scheduler started", {
    jobs: JOBS.map((job) => ({ jobKey: job.jobKey, intervalMs: job.intervalMs })),
  });
}

export async function stopApplicationScheduler(): Promise<void> {
  schedulerRunning = false;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  await Promise.allSettled(activeRuns);
  activeRuns.clear();
}
