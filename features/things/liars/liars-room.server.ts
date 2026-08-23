import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { LiarsRoomService } from "./liars-room-service.server";

import type * as engine from "./liars-room-engine.server";
import { markGamePoolPlayerLeft, markGamePoolPlayersRemoved } from "../pool/membership.server";

export function authorizeLiarsSocket(input: Parameters<typeof engine.authorizeLiarsSocket>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.authorizeSocket(input)));
}

export function createLiarsRoom(input: Parameters<typeof engine.createLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.createRoom(input)));
}

export function joinLiarsRoom(input: Parameters<typeof engine.joinLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("liars", input.roomId).catch(() => undefined);
      return result;
    },
  );
}

export function readLiarsSnapshot(input: Parameters<typeof engine.readLiarsSnapshot>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.readSnapshot(input)));
}

export function applyLiarsHostAction(input: Parameters<typeof engine.applyLiarsHostAction>[0]) {
  return runMultiplayerEffect(
    LiarsRoomService.use((service) => service.applyHostAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("liars", input.roomId).catch(() => undefined);
    if (result.ok && result.accepted && input.action.type === "player.remove") {
      await markGamePoolPlayersRemoved({
        roomId: input.roomId,
        playerIds: [input.action.playerId],
        actionId: input.action.actionId,
      }).catch(() => undefined);
      await publishMultiplayerRoomTermination("liars", input.roomId, {
        reason: "removed",
        playerId: input.action.playerId,
      }).catch(() => undefined);
    }
    return result;
  });
}

export function applyLiarsPlayerAction(input: Parameters<typeof engine.applyLiarsPlayerAction>[0]) {
  return runMultiplayerEffect(
    LiarsRoomService.use((service) => service.applyPlayerAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("liars", input.roomId).catch(() => undefined);
    if (result.ok && result.accepted && input.action.type === "room.leave") {
      await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
        () => undefined,
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
