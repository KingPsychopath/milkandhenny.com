import { disposeEventsRuntime } from "@/features/events/events-runtime.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await disposeEventsRuntime();
    log.info("events", "Managed runtime disposed");
  });
});
