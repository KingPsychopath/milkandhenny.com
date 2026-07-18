import { disposeMultiplayerRuntime } from "@/features/things/shared/multiplayer-runtime.server";
import { log } from "@/lib/platform/logger.server";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", async () => {
    await disposeMultiplayerRuntime();
    log.info("things.multiplayer", "Managed runtime disposed");
  });
});
