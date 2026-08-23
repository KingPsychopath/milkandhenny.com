import { authorizeGamePoolSocket } from "@/features/things/pool/pool.server";
import { gamePoolRealtimeChannel } from "@/features/things/pool/pool-keys";
import { createMultiplayerWakeHandler } from "@/features/things/shared/multiplayer-wake-handler.server";

export default createMultiplayerWakeHandler({
  channel: gamePoolRealtimeChannel,
  game: "game-pool",
  async authorize(payload) {
    const token = typeof payload.token === "string" ? payload.token : "";
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    return authorizeGamePoolSocket(token, runId);
  },
});
