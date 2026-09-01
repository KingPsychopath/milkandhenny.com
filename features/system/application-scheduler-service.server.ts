import { Context, Deferred, Effect, Fiber, Layer, Schedule } from "effect";

import { sendOperationsDigests } from "@/features/attendee-operations/notifications.server";
import { CommunicationsService } from "@/features/communications/communications-service.server";
import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { eventsOperation } from "@/features/events/events-operation.server";
import { runAutomaticPitchReminders } from "@/features/things/pitches/reminders.server";
import { cleanupGamePools } from "@/features/things/pool/operations.server";
import { log } from "@/lib/platform/logger.server";
import {
  runLeasedScheduledJobEffect,
  type ScheduledJobRun,
} from "@/lib/platform/scheduled-jobs.server";
import { BASE_URL } from "@/lib/shared/config";
import { isMediaWorkerRole } from "./media-role.server";

const EMAIL_INTERVAL_MS = 15_000;
const EVENT_SCORING_INTERVAL_MS = 30_000;
const OPERATIONS_DIGEST_INTERVAL_MS = 5 * 60_000;
const PITCH_REMINDER_INTERVAL_MS = 15 * 60_000;
const GAME_POOL_CLEANUP_INTERVAL_MS = 15 * 60_000;
const JOB_LEASE_MS = 10 * 60_000;
const JOB_TIMEOUT_MS = 2 * 60_000;

function schedulerDisabled(): boolean {
  return ["1", "true", "yes"].includes(
    (process.env.APP_SCHEDULER_DISABLED ?? "").trim().toLowerCase(),
  );
}

function schedulerOperation<A>(operation: string, run: (signal: AbortSignal) => Promise<A>) {
  return eventsOperation(
    {
      domain: "scheduler",
      operation,
      kind: "idempotent-mutation",
      timeoutMs: JOB_TIMEOUT_MS,
    },
    run,
  );
}

function leased<T, E, R>(input: {
  force?: boolean;
  intervalMs: number;
  jobKey: string;
  run: Effect.Effect<T, E, R>;
}) {
  return runLeasedScheduledJobEffect({
    jobKey: input.jobKey,
    intervalMs: input.intervalMs,
    retryMs: input.intervalMs,
    leaseMs: JOB_LEASE_MS,
    force: input.force,
    run: input.run.pipe(Effect.timeout(JOB_TIMEOUT_MS)),
  });
}

export class ApplicationSchedulerService extends Context.Service<
  ApplicationSchedulerService,
  {
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly runCommunications: (force?: boolean) => Effect.Effect<
      ScheduledJobRun<{
        staged: number;
        waitlistAlerts: number;
        handled: number;
      }>,
      unknown
    >;
    readonly runEventScoring: (force?: boolean) => Effect.Effect<
      ScheduledJobRun<{
        outbox: { selected: number; delivered: number };
        result: { selected: number; processed: number; held: number; ignored: number };
        scoringTransitions: number;
      }>,
      unknown
    >;
    readonly runOperationsDigests: (
      force?: boolean,
    ) => Effect.Effect<ScheduledJobRun<Awaited<ReturnType<typeof sendOperationsDigests>>>, unknown>;
    readonly runGamePoolCleanup: (
      force?: boolean,
    ) => Effect.Effect<ScheduledJobRun<Awaited<ReturnType<typeof cleanupGamePools>>>, unknown>;
    readonly runPitchReminders: (force?: boolean) => Effect.Effect<
      ScheduledJobRun<{
        queuedEmails: number;
        sentDecks: number;
        failedDecks: number;
        automatic: boolean;
      }>,
      unknown
    >;
  }
>()("ApplicationSchedulerService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const communications = yield* CommunicationsService;
      const scoring = yield* EventScoringService;
      const startGate = yield* Deferred.make<void>();
      const stopGate = yield* Deferred.make<void>();

      const runCommunications = (force = false) =>
        leased({
          force,
          jobKey: "communications-delivery",
          intervalMs: EMAIL_INTERVAL_MS,
          run: communications.runScheduled,
        });
      const runEventScoring = (force = false) =>
        leased({
          force,
          jobKey: "event-scoring",
          intervalMs: EVENT_SCORING_INTERVAL_MS,
          run: scoring.runScheduled,
        });
      const runOperationsDigests = (force = false) =>
        leased({
          force,
          jobKey: "operations-digests",
          intervalMs: OPERATIONS_DIGEST_INTERVAL_MS,
          run: schedulerOperation("operations_digests", () => sendOperationsDigests()),
        });
      const runGamePoolCleanup = (force = false) =>
        leased({
          force,
          jobKey: "game-pool-cleanup",
          intervalMs: GAME_POOL_CLEANUP_INTERVAL_MS,
          run: schedulerOperation("game_pool_cleanup", () => cleanupGamePools()),
        });
      const runPitchReminders = (force = false) =>
        leased({
          force,
          jobKey: "pitch-reminders",
          intervalMs: PITCH_REMINDER_INTERVAL_MS,
          run: schedulerOperation("pitch_reminders", () =>
            runAutomaticPitchReminders({ origin: BASE_URL }),
          ),
        });

      const forkJob = <A, E>(
        definition: {
          jobKey: string;
          intervalMs: number;
          run: () => Effect.Effect<ScheduledJobRun<A>, E>;
          report: (outcome: ScheduledJobRun<A>) => void;
        },
        index: number,
      ) => {
        const oneRun = definition.run().pipe(
          Effect.tap((outcome) => Effect.sync(() => definition.report(outcome))),
          Effect.catch((error) =>
            Effect.sync(() =>
              log.error(
                "scheduler.job",
                "Application scheduled job failed",
                { jobKey: definition.jobKey },
                error,
              ),
            ),
          ),
        );
        const activeLoop = Deferred.await(startGate).pipe(
          Effect.andThen(Effect.sleep(index * 250)),
          Effect.andThen(Effect.repeat(oneRun, Schedule.spaced(definition.intervalMs))),
          Effect.asVoid,
        );
        return Effect.race(Deferred.await(stopGate), activeLoop).pipe(Effect.forkScoped);
      };

      const fibers = yield* Effect.all([
        forkJob(
          {
            jobKey: "communications-delivery",
            intervalMs: EMAIL_INTERVAL_MS,
            run: runCommunications,
            report: (outcome) => {
              if (
                outcome.ran &&
                (outcome.value.staged > 0 ||
                  outcome.value.waitlistAlerts > 0 ||
                  outcome.value.handled > 0)
              ) {
                log.info(
                  "scheduler.communications",
                  "Scheduled email work completed",
                  outcome.value,
                );
              }
            },
          },
          0,
        ),
        forkJob(
          {
            jobKey: "event-scoring",
            intervalMs: EVENT_SCORING_INTERVAL_MS,
            run: runEventScoring,
            report: (outcome) => {
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
          1,
        ),
        forkJob(
          {
            jobKey: "operations-digests",
            intervalMs: OPERATIONS_DIGEST_INTERVAL_MS,
            run: runOperationsDigests,
            report: (outcome) => {
              if (outcome.ran && outcome.value.queued > 0)
                log.info(
                  "scheduler.operations-digests",
                  "Operations digests queued",
                  outcome.value,
                );
            },
          },
          2,
        ),
        forkJob(
          {
            jobKey: "pitch-reminders",
            intervalMs: PITCH_REMINDER_INTERVAL_MS,
            run: runPitchReminders,
            report: (outcome) => {
              if (
                outcome.ran &&
                (outcome.value.queuedEmails > 0 || outcome.value.failedDecks > 0)
              ) {
                log.info("scheduler.pitch-reminders", "Pitch reminder work completed", {
                  automatic: outcome.value.automatic,
                  failedDecks: outcome.value.failedDecks,
                  queuedEmails: outcome.value.queuedEmails,
                  sentDecks: outcome.value.sentDecks,
                });
              }
            },
          },
          3,
        ),
      ]);

      const jobSummaries = [
        { jobKey: "communications-delivery", intervalMs: EMAIL_INTERVAL_MS },
        { jobKey: "event-scoring", intervalMs: EVENT_SCORING_INTERVAL_MS },
        { jobKey: "operations-digests", intervalMs: OPERATIONS_DIGEST_INTERVAL_MS },
        { jobKey: "pitch-reminders", intervalMs: PITCH_REMINDER_INTERVAL_MS },
      ];

      return {
        start:
          schedulerDisabled() || isMediaWorkerRole()
            ? Effect.void
            : Deferred.succeed(startGate, undefined).pipe(
                Effect.tap((started) =>
                  started
                    ? Effect.sync(() =>
                        log.info("scheduler", "Application scheduler started", {
                          jobs: jobSummaries,
                        }),
                      )
                    : Effect.void,
                ),
                Effect.asVoid,
              ),
        stop: Deferred.succeed(stopGate, undefined).pipe(
          Effect.andThen(Effect.forEach(fibers, Fiber.await, { discard: true })),
        ),
        runCommunications,
        runEventScoring,
        runGamePoolCleanup,
        runOperationsDigests,
        runPitchReminders,
      };
    }),
  );
}
