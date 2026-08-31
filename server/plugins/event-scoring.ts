import { definePlugin } from "nitro";

import { consumeOfficialGameResult } from "@/features/event-scoring/games.server";
import {
  consumeOfficialResultWake,
  subscribeOfficialResultWake,
} from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import { closeScoreEventSubscriber } from "@/features/event-scoring/score-events.server";
import { closeTicketEventSubscriber } from "@/features/tickets/ticket-events.server";

export default definePlugin((nitroApp) => {
  let consuming = false;
  let drainRequested = false;
  const pending = new Map<string, OfficialGameResultEnvelope>();

  const stop = subscribeOfficialResultWake(async (envelopes) => {
    if (envelopes.length === 0) drainRequested = true;
    for (const envelope of envelopes) pending.set(envelope.payloadHash, envelope);
    if (consuming) return;
    consuming = true;
    try {
      while (drainRequested || pending.size > 0) {
        const shouldDrain = drainRequested;
        drainRequested = false;
        const batch = [...pending.values()];
        pending.clear();
        await consumeOfficialResultWake(shouldDrain ? [] : batch, consumeOfficialGameResult);
      }
    } finally {
      consuming = false;
    }
  });
  nitroApp.hooks.hook("close", async () => {
    stop();
    await closeScoreEventSubscriber();
    await closeTicketEventSubscriber();
  });
});
