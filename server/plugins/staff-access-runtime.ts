import { disposeStaffAccessRuntime } from "@/features/event-scoring/staff-access-runtime.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await disposeStaffAccessRuntime();
    log.info("event-staff", "Managed runtime disposed");
  });
});
