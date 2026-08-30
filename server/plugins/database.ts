import { definePlugin } from "nitro";

import { log } from "@/lib/platform/logger.server";
import { closePool, isDatabaseConfigured } from "@/lib/platform/postgres.server";
import { runMigrations } from "@/lib/platform/migrations.server";
import { startEmailOutboxWorker, stopEmailOutboxWorker } from "@/lib/platform/email-outbox.server";
import {
  startApplicationScheduler,
  stopApplicationScheduler,
} from "@/features/system/scheduled-jobs.server";
import {
  markDatabaseFailed,
  markDatabaseMigrationsStarted,
  markDatabaseReady,
} from "@/lib/platform/database-readiness.server";

/**
 * Apply migrations on boot, close the pool on shutdown.
 *
 * Migrations run here rather than as a separate deploy step so a fresh
 * environment is self-configuring, and so the schema can never lag the code
 * that expects it. They take an advisory lock, so several replicas booting
 * together is safe.
 *
 * A migration failure is deliberately not fatal to the process: the
 * `/api/health` database probe reports it, and the rest of the site — words,
 * pics, games — keeps serving rather than the whole app refusing to start
 * over a ticketing table.
 */
export default definePlugin(async (nitroApp) => {
  if (isDatabaseConfigured()) {
    markDatabaseMigrationsStarted();
    try {
      const result = await runMigrations();
      if (result.applied.length > 0) {
        log.info("postgres.migrate", "Migrations applied", {
          applied: result.applied,
          alreadyApplied: result.alreadyApplied,
        });
      }
      markDatabaseReady(result.pitchDocuments);
      startEmailOutboxWorker();
      startApplicationScheduler();
    } catch (error) {
      markDatabaseFailed(error);
      log.error("postgres.migrate", "Migrations failed on boot", {}, error);
    }
  } else {
    log.warn("postgres", "DATABASE_URL is not set; events and ticketing are unavailable");
  }

  nitroApp.hooks.hook("close", async () => {
    await stopApplicationScheduler();
    await stopEmailOutboxWorker();
    await closePool();
    log.info("postgres", "Connection pool closed");
  });
});
