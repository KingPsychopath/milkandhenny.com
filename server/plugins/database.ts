import { definePlugin } from "nitro";

import { log } from "@/lib/platform/logger.server";
import { isDatabaseConfigured } from "@/lib/platform/postgres.server";
import { runMigrations, verifyMigrations } from "@/lib/platform/migrations.server";
import { disposeEventsRuntime } from "@/features/events/events-runtime.server";
import { isMediaWorkerRole } from "@/features/system/media-role.server";
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
 * Apply or verify migrations on boot. The process shutdown bridge closes the
 * shared pool after all subsystem runtimes have stopped.
 *
 * A privileged local environment may apply migrations on boot. Production can
 * set DATABASE_SCHEMA_MODE=verify after running the separate migration command
 * and use an unprivileged runtime role. Verification never attempts DDL.
 *
 * A migration failure is deliberately not fatal to the process: the
 * `/api/health` database probe reports it, and the rest of the site — words,
 * pics, games — keeps serving rather than the whole app refusing to start
 * over a ticketing table.
 */
export default definePlugin(async (nitroApp) => {
  // Register before migration I/O: Nitro invokes plugins without awaiting async startup.
  // The shutdown bridge must see this hook before it closes the shared pool.
  nitroApp.hooks.hook("close", async () => {
    await stopApplicationScheduler();
    await disposeEventsRuntime();
  });

  if (isDatabaseConfigured()) {
    markDatabaseMigrationsStarted();
    try {
      const schemaMode = process.env.DATABASE_SCHEMA_MODE ?? "migrate";
      if (schemaMode !== "migrate" && schemaMode !== "verify") {
        throw new Error("DATABASE_SCHEMA_MODE must be migrate or verify");
      }
      if (isMediaWorkerRole() && schemaMode !== "verify") {
        throw new Error("Media worker requires DATABASE_SCHEMA_MODE=verify");
      }
      const result =
        schemaMode === "verify"
          ? await verifyMigrations({ includePitchDocuments: !isMediaWorkerRole() })
          : await runMigrations();
      if (result.applied.length > 0) {
        log.info("postgres.migrate", "Migrations applied", {
          applied: result.applied,
          alreadyApplied: result.alreadyApplied,
        });
      }
      markDatabaseReady(result.pitchDocuments);
      await startApplicationScheduler();
    } catch (error) {
      markDatabaseFailed(error);
      log.error("postgres.migrate", "Migrations failed on boot", {}, error);
    }
  } else {
    log.warn("postgres", "DATABASE_URL is not set; events and ticketing are unavailable");
  }
});
