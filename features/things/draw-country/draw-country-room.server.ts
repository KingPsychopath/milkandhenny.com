import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { DrawCountryRoomService } from "./draw-country-room-service.server";
import type * as engine from "./draw-country-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export function createDrawCountryRoom(input: Parameters<typeof engine.createDrawCountryRoom>[0]) {
  return runMultiplayerEffect(DrawCountryRoomService.use((service) => service.createRoom(input)));
}

export function joinDrawCountryRoom(input: Parameters<typeof engine.joinDrawCountryRoom>[0]) {
  return runMultiplayerEffect(
    DrawCountryRoomService.use((service) => service.joinRoom(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("draw-country", input.roomId).catch(() => undefined);
    return result;
  });
}

export function readDrawCountrySnapshot(
  input: Parameters<typeof engine.readDrawCountrySnapshot>[0],
) {
  return runMultiplayerEffect(
    DrawCountryRoomService.use((service) => service.readSnapshot(input)),
  ).then(async (result) => {
    if (result.ok)
      await markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }).catch(
        () => undefined,
      );
    return result;
  });
}

export function applyDrawCountryAction(input: Parameters<typeof engine.applyDrawCountryAction>[0]) {
  return runMultiplayerEffect(
    DrawCountryRoomService.use((service) => service.applyAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("draw-country", input.roomId).catch(() => undefined);
    if (result.ok && result.accepted && input.action.type === "player.leave") {
      await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
        () => undefined,
      );
      await publishMultiplayerRoomTermination("draw-country", input.roomId, {
        reason: "session_ended",
        playerId: input.playerId,
      }).catch(() => undefined);
    }
    if (result.ok && result.accepted && input.action.type === "game.start") {
      await markGamePoolPlayersRemoved({
        roomId: input.roomId,
        playerIds: input.action.removePlayerIds ?? [],
        actionId: input.action.actionId ?? crypto.randomUUID(),
      }).catch(() => undefined);
      for (const playerId of input.action.removePlayerIds ?? [])
        await publishMultiplayerRoomTermination("draw-country", input.roomId, {
          reason: "removed",
          playerId,
        }).catch(() => undefined);
    }
    return result;
  });
}

export function authorizeDrawCountrySocket(
  input: Parameters<typeof engine.authorizeDrawCountrySocket>[0],
) {
  return runMultiplayerEffect(
    DrawCountryRoomService.use((service) => service.authorizeSocket(input)),
  );
}
