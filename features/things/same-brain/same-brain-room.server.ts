import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { SameBrainRoomService } from "./same-brain-room-service.server";

import type * as engine from "./same-brain-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export function authorizeSameBrainSocket(
  input: Parameters<typeof engine.authorizeSameBrainSocket>[0],
) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.authorizeSocket(input)),
  );
}

export function createSameBrainRoom(input: Parameters<typeof engine.createSameBrainRoom>[0]) {
  return runMultiplayerEffect(SameBrainRoomService.use((service) => service.createRoom(input)));
}

export function joinSameBrainRoom(input: Parameters<typeof engine.joinSameBrainRoom>[0]) {
  return runMultiplayerEffect(SameBrainRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("same-brain", input.roomId).catch(() => undefined);
      return result;
    },
  );
}

export function readSameBrainSnapshot(input: Parameters<typeof engine.readSameBrainSnapshot>[0]) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.readSnapshot(input)),
  ).then(async (result) => {
    if (result.ok && input.playerId)
      await markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }).catch(
        () => undefined,
      );
    return result;
  });
}

export function applySameBrainHostAction(
  input: Parameters<typeof engine.applySameBrainHostAction>[0],
) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.applyHostAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("same-brain", input.roomId).catch(() => undefined);
    if (result.accepted && input.action.type === "player.remove") {
      await markGamePoolPlayersRemoved({
        roomId: input.roomId,
        playerIds: [input.action.playerId],
        actionId: input.action.actionId,
      }).catch(() => undefined);
      await publishMultiplayerRoomTermination("same-brain", input.roomId, {
        reason: "removed",
        playerId: input.action.playerId,
      }).catch(() => undefined);
    }
    if (result.accepted && input.action.type === "game.start") {
      const remainingPlayerIds = new Set(result.snapshot.players.map(({ id }) => id));
      const removedPlayerIds = (input.action.removePlayerIds ?? []).filter(
        (playerId) => !remainingPlayerIds.has(playerId),
      );
      if (removedPlayerIds.length > 0) {
        await markGamePoolPlayersRemoved({
          roomId: input.roomId,
          playerIds: removedPlayerIds,
          actionId: input.action.actionId,
        }).catch(() => undefined);
        for (const playerId of removedPlayerIds)
          await publishMultiplayerRoomTermination("same-brain", input.roomId, {
            reason: "removed",
            playerId,
          }).catch(() => undefined);
      }
    }
    return result;
  });
}

export function applySameBrainPlayerAction(
  input: Parameters<typeof engine.applySameBrainPlayerAction>[0],
) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.applyPlayerAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("same-brain", input.roomId).catch(() => undefined);
    if (result.accepted && input.action.type === "room.leave") {
      await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
        () => undefined,
      );
      await publishMultiplayerRoomTermination("same-brain", input.roomId, {
        reason: "session_ended",
        playerId: input.playerId,
      }).catch(() => undefined);
    }
    return result;
  });
}

export function closeSameBrainRoom(...input: Parameters<typeof engine.closeSameBrainRoom>) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.closeRoom(...input)),
  ).then(async (result) => {
    if (result.ok)
      await publishMultiplayerRoomTermination("same-brain", input[0], {
        reason: "room_closed",
      }).catch(() => undefined);
    return result;
  });
}
