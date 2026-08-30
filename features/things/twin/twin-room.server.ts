import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { TwinRoomService } from "./twin-room-service.server";
import type * as engine from "./twin-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export function createTwinRoom(input: Parameters<typeof engine.createTwinRoom>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.createRoom(input)));
}

export function joinTwinRoom(input: Parameters<typeof engine.joinTwinRoom>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("twin", input.roomId).catch(() => undefined);
      return result;
    },
  );
}

export function readTwinSnapshot(input: Parameters<typeof engine.readTwinSnapshot>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.readSnapshot(input))).then(
    async (result) => {
      if (result.ok)
        await markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
      return result;
    },
  );
}

export function readTwinLog(input: Parameters<typeof engine.readTwinLog>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.readLog(input)));
}

export function applyTwinAction(input: Parameters<typeof engine.applyTwinAction>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.applyAction(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("twin", input.roomId).catch(() => undefined);
      if (result.ok && result.accepted && input.action.type === "player.leave") {
        await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
        await publishMultiplayerRoomTermination("twin", input.roomId, {
          reason: "session_ended",
          playerId: input.playerId,
        }).catch(() => undefined);
      }
      if (result.ok && result.accepted && input.action.type === "game.start") {
        const remainingPlayerIds = new Set(result.snapshot.players.map(({ id }) => id));
        const removedPlayerIds = (input.action.removePlayerIds ?? []).filter(
          (playerId) => !remainingPlayerIds.has(playerId),
        );
        await markGamePoolPlayersRemoved({
          roomId: input.roomId,
          playerIds: removedPlayerIds,
          actionId: input.action.actionId ?? crypto.randomUUID(),
        }).catch(() => undefined);
        for (const playerId of removedPlayerIds)
          await publishMultiplayerRoomTermination("twin", input.roomId, {
            reason: "removed",
            playerId,
          }).catch(() => undefined);
      }
      return result;
    },
  );
}

export function authorizeTwinSocket(input: Parameters<typeof engine.authorizeTwinSocket>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.authorizeSocket(input)));
}
