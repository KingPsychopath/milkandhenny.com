import { definePlugin } from "nitro";

import {
  ingestOfficialGameResult,
  processOfficialGameResult,
} from "@/features/event-scoring/games.server";
import { registerOfficialGameResultConsumer } from "@/features/things/shared/official-game-results.server";

export default definePlugin((nitroApp) => {
  registerOfficialGameResultConsumer(async (envelope) => {
    const ingested = await ingestOfficialGameResult(envelope);
    if (!ingested.ok) return ingested.status === 409;
    if (!ingested.value.duplicate) await processOfficialGameResult(ingested.value.id);
    return true;
  });
  nitroApp.hooks.hook("close", () => registerOfficialGameResultConsumer(undefined));
});
