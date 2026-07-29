import { disposePitchesRuntime } from "@/features/things/pitches/pitches-runtime.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await disposePitchesRuntime();
    log.info("pitches", "Managed runtime disposed");
  });
});
