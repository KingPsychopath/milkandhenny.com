import { settleGamePoolBookkeeping } from "../pool/bookkeeping.server";
import {
  publishMultiplayerRoomTermination,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { LiarsRoomService } from "./liars-room-service.server";

import type * as engine from "./liars-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export function authorizeLiarsSocket(input: Parameters<typeof engine.authorizeLiarsSocket>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.authorizeSocket(input)));
}

export function createLiarsRoom(input: Parameters<typeof engine.createLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.createRoom(input)));
}

export function joinLiarsRoom(input: Parameters<typeof engine.joinLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      return result;
    },
  );
}

export function readLiarsSnapshot(input: Parameters<typeof engine.readLiarsSnapshot>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.readSnapshot(input))).then(
    async (result) => {
      if (result.ok && input.playerId)
        await settleGamePoolBookkeeping(
          markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }),
        );
      return result;
    },
  );
}

export function applyLiarsHostAction(input: Parameters<typeof engine.applyLiarsHostAction>[0]) {
  return runMultiplayerEffect(
    LiarsRoomService.use((service) => service.applyHostAction(input)),
  ).then(async (result) => {
    if (result.ok && result.accepted && input.action.type === "player.remove") {
      await settleGamePoolBookkeeping(
        markGamePoolPlayersRemoved({
          roomId: input.roomId,
          playerIds: [input.action.playerId],
          actionId: input.action.actionId,
        }),
      );
      await publishMultiplayerRoomTermination("liars", input.roomId, {
        reason: "removed",
        playerId: input.action.playerId,
      }).catch(() => undefined);
    }
    if (result.ok && result.accepted && input.action.type === "game.start") {
      const remainingPlayerIds = new Set(result.snapshot.players.map(({ id }) => id));
      const removedPlayerIds = (input.action.removePlayerIds ?? []).filter(
        (playerId) => !remainingPlayerIds.has(playerId),
      );
      if (removedPlayerIds.length > 0) {
        await settleGamePoolBookkeeping(
          markGamePoolPlayersRemoved({
            roomId: input.roomId,
            playerIds: removedPlayerIds,
            actionId: input.action.actionId,
          }),
        );
        for (const playerId of removedPlayerIds)
          await publishMultiplayerRoomTermination("liars", input.roomId, {
            reason: "removed",
            playerId,
          }).catch(() => undefined);
      }
    }
    return result;
  });
}

export function applyLiarsPlayerAction(input: Parameters<typeof engine.applyLiarsPlayerAction>[0]) {
  return runMultiplayerEffect(
    LiarsRoomService.use((service) => service.applyPlayerAction(input)),
  ).then(async (result) => {
    if (result.ok && result.accepted && input.action.type === "room.leave") {
      await settleGamePoolBookkeeping(
        markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }),
      );
      await publishMultiplayerRoomTermination("liars", input.roomId, {
        reason: "session_ended",
        playerId: input.playerId,
      }).catch(() => undefined);
    }
    return result;
  });
}

export function closeLiarsRoom(...input: Parameters<typeof engine.closeLiarsRoom>) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.closeRoom(...input))).then(
    async (result) => {
      if (result.ok)
        await publishMultiplayerRoomTermination("liars", input[0], {
          reason: "room_closed",
        }).catch(() => undefined);
      return result;
    },
  );
}
