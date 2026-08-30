import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { PartyRoomService } from "./party-room-service.server";

import type * as engine from "./party-room-engine.server";

export function authorizePartySocket(input: Parameters<typeof engine.authorizePartySocket>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.authorizeSocket(input)));
}

export function createPartyRoom(input: Parameters<typeof engine.createPartyRoom>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.createRoom(input)));
}

export function joinPartyRoom(input: Parameters<typeof engine.joinPartyRoom>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("spelling-party", input.roomId).catch(() => undefined);
      return result;
    },
  );
}

export function readPartySnapshot(input: Parameters<typeof engine.readPartySnapshot>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.readSnapshot(input)));
}

export function applyPresenterAction(input: Parameters<typeof engine.applyPresenterAction>[0]) {
  return runMultiplayerEffect(
    PartyRoomService.use((service) => service.applyPresenterAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("spelling-party", input.roomId).catch(() => undefined);
    if (result.ok && result.accepted && input.action.type === "round.start") {
      const remainingPlayerIds = new Set(result.snapshot.players.map(({ id }) => id));
      const removedPlayerIds = (input.action.removePlayerIds ?? []).filter(
        (playerId) => !remainingPlayerIds.has(playerId),
      );
      for (const playerId of removedPlayerIds)
        await publishMultiplayerRoomTermination("spelling-party", input.roomId, {
          reason: "removed",
          playerId,
        }).catch(() => undefined);
    }
    return result;
  });
}

export function applyPlayerAction(input: Parameters<typeof engine.applyPlayerAction>[0]) {
  return runMultiplayerEffect(
    PartyRoomService.use((service) => service.applyPlayerAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("spelling-party", input.roomId).catch(() => undefined);
    if (result.ok && result.accepted && input.action.type === "room.leave")
      await publishMultiplayerRoomTermination("spelling-party", input.roomId, {
        reason: "session_ended",
        playerId: input.playerId,
      }).catch(() => undefined);
    return result;
  });
}

export function getPartyAudioAsset(...input: Parameters<typeof engine.getPartyAudioAsset>) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.getAudioAsset(...input)));
}

export function closePartyRoom(...input: Parameters<typeof engine.closePartyRoom>) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.closeRoom(...input))).then(
    async (result) => {
      if (result.ok)
        await publishMultiplayerRoomTermination("spelling-party", input[0], {
          reason: "room_closed",
        }).catch(() => undefined);
      return result;
    },
  );
}
