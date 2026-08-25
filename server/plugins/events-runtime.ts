import { disposeEventsRuntime } from "@/features/events/events-runtime.server";
import { disposeEventOperationsRuntime } from "@/features/event-operations/runtime.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await Promise.all([disposeEventsRuntime(), disposeEventOperationsRuntime()]);
    log.info("events", "Managed runtime disposed");
  });
});
