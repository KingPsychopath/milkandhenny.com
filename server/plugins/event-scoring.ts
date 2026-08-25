import { definePlugin } from "nitro";

import { consumeOfficialGameResult } from "@/features/event-scoring/games.server";
import { registerOfficialGameResultConsumer } from "@/features/things/shared/official-game-results.server";

export default definePlugin((nitroApp) => {
  registerOfficialGameResultConsumer(consumeOfficialGameResult);
  nitroApp.hooks.hook("close", () => registerOfficialGameResultConsumer(undefined));
});
