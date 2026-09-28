import { Cause, Effect, Exit } from "effect";

import { cleanupPostgresAttendeeSessions } from "@/features/attendee-access/session-postgres.server";
import { cleanupPostgresPasskeyCeremonies } from "@/features/attendee-access/passkey-ceremony-postgres.server";
import type { AttendeeOperationsService } from "@/features/attendee-operations/attendee-operations-service.server";
import { cleanupPostgresCliAuth } from "@/features/auth/cli-auth-postgres.server";
import { cleanupPostgresTokenState } from "@/features/auth/internal/token-state-postgres.server";
import { cleanupPostgresBestDressed } from "@/features/best-dressed/best-dressed-postgres.server";
import type { CommunicationsService } from "@/features/communications/communications-service.server";
import { cleanupPostgresReports } from "@/features/reports/report-store.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import { runPitchesEffect } from "@/features/things/pitches/pitches-runtime.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { cleanupRateLimitWindows } from "@/lib/platform/rate-limit.server";
import { log } from "@/lib/platform/logger.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { MediaMaintenanceService } from "./media-maintenance-service.server";
import { MediaWorkerService, runMediaEffect } from "./media-worker-runtime.server";

export type DailyMaintenanceStep = {
  key: string;
  run: Effect.Effect<unknown, unknown>;
};

const STEP_TIMEOUT_MS = 10 * 60_000;

function operation(
  key: string,
  run: (signal: AbortSignal) => Promise<unknown>,
): DailyMaintenanceStep {
  return {
    key,
    run: Effect.tryPromise({
      try: (signal) => withOperationSignal(signal, () => run(signal)),
      catch: (cause) => cause,
    }),
  };
}

/** The five product-time tasks from the old cron runner already have their own leased web jobs. */
export function dailyMaintenanceSteps(services: {
  communications: typeof CommunicationsService.Service;
  attendee: typeof AttendeeOperationsService.Service;
}): DailyMaintenanceStep[] {
  return [
    operation("transfers", (signal) =>
      runMediaEffect(
        Effect.gen(function* () {
          return yield* (yield* TransferOperationsService).cleanup("deep");
        }),
        signal,
      ),
    ),
    operation("pitches", (signal) =>
      runPitchesEffect(
        Effect.gen(function* () {
          return yield* (yield* PitchesService).cleanup();
        }),
        signal,
      ),
    ),
    { key: "communication-links", run: services.communications.cleanupLinks },
    { key: "email-retention", run: services.communications.cleanupEmail },
    { key: "attendee-access", run: services.attendee.cleanupExpired },
    operation("attendee-sessions", async () => {
      await Promise.all([cleanupPostgresAttendeeSessions(), cleanupPostgresPasskeyCeremonies()]);
    }),
    operation("rate-limits", () => cleanupRateLimitWindows()),
    operation("reports", () => cleanupPostgresReports()),
    operation("best-dressed", () =>
      process.env.BEST_DRESSED_STORE === "postgres"
        ? cleanupPostgresBestDressed()
        : Promise.resolve(),
    ),
    operation("auth-state", async () => {
      await Promise.all([cleanupPostgresTokenState(), cleanupPostgresCliAuth()]);
    }),
    operation("word-shares", (signal) =>
      isWordsEnabled()
        ? runMediaEffect(
            Effect.gen(function* () {
              return yield* (yield* MediaMaintenanceService).cleanupWordShares();
            }),
            signal,
          )
        : Promise.resolve(),
    ),
    operation("word-media-orphans", (signal) =>
      runMediaEffect(
        Effect.gen(function* () {
          return yield* (yield* MediaMaintenanceService).cleanupWordMedia;
        }),
        signal,
      ),
    ),
    operation("transfer-media-reconciliation", (signal) =>
      runMediaEffect(
        Effect.gen(function* () {
          return yield* (yield* MediaWorkerService).reconcile;
        }),
        signal,
      ),
    ),
  ];
}

/** Continue bounded housekeeping after one failure; fail the lease so it retries and alerts. */
export function runDailyMaintenanceSteps(steps: readonly DailyMaintenanceStep[]) {
  return Effect.gen(function* () {
    const failed: string[] = [];
    for (const step of steps) {
      const startedAt = Date.now();
      const exit = yield* Effect.exit(step.run.pipe(Effect.timeout(STEP_TIMEOUT_MS)));
      if (Exit.isFailure(exit)) {
        failed.push(step.key);
        log.error(
          "scheduler.maintenance",
          "Daily maintenance task failed",
          { task: step.key, durationMs: Date.now() - startedAt },
          Cause.squash(exit.cause),
        );
      } else {
        log.info("scheduler.maintenance", "Daily maintenance task completed", {
          task: step.key,
          durationMs: Date.now() - startedAt,
        });
      }
    }
    if (failed.length > 0) {
      return yield* Effect.fail(new Error(`Daily maintenance failed: ${failed.join(", ")}`));
    }
    return { completed: steps.length };
  });
}
