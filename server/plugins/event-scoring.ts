import { definePlugin } from "nitro";

import {
  ingestOfficialGameResult,
  processOfficialGameResultSafely,
} from "@/features/event-scoring/games.server";
import { registerOfficialGameResultConsumer } from "@/features/things/shared/official-game-results.server";

export default definePlugin((nitroApp) => {
  registerOfficialGameResultConsumer(async (envelope) => {
    const ingested = await ingestOfficialGameResult(envelope);
    // A retryable refusal (binding still provisioning, an earlier revision still in flight)
    // keeps the envelope queued; only a permanent refusal consumes it.
    if (!ingested.ok) return !ingested.retryable;
    if (!ingested.value.duplicate) await processOfficialGameResultSafely(ingested.value.id);
    return true;
  });
  nitroApp.hooks.hook("close", () => registerOfficialGameResultConsumer(undefined));
});
