import { definePlugin } from "nitro";

import { log } from "@/lib/platform/logger.server";
import { closePool } from "@/lib/platform/postgres.server";

/**
 * The Node server's signal handler closes HTTP, but does not invoke Nitro's
 * application close hook. Bridge the two so workers stop claiming before the
 * shared Postgres pool is closed. This plugin loads after subsystem plugins.
 */
export default definePlugin((nitroApp) => {
  let closing: Promise<void> | null = null;
  const onSignal = () => {
    closing ??= Promise.resolve(nitroApp.hooks.callHook("close")).catch(async (error) => {
      log.error("runtime.shutdown", "Application close hook failed", {}, error);
      process.exitCode = 1;
      await closePool({ permanent: true }).catch(() => undefined);
    });
  };

  if (process.env.NODE_ENV === "production") {
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  }
  nitroApp.hooks.hook("close", async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await closePool({ permanent: true });
    log.info("postgres", "Connection pool closed");
  });
});
