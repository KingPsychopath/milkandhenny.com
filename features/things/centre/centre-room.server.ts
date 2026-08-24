import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { CentreRoomService } from "./centre-room-service.server";
import type * as engine from "./centre-room-engine.server";
import {
  markGamePoolPlayerLeft,
  markGamePoolPlayerSeen,
  markGamePoolPlayersRemoved,
} from "../pool/membership.server";

export function createCentreRoom(input: Parameters<typeof engine.createCentreRoom>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.createRoom(input)));
}
export function joinCentreRoom(input: Parameters<typeof engine.joinCentreRoom>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.joinRoom(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("centre", input.roomId).catch(() => undefined);
      return result;
    },
  );
}
export function readCentreSnapshot(input: Parameters<typeof engine.readCentreSnapshot>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.readSnapshot(input))).then(
    async (result) => {
      if (result.ok)
        await markGamePoolPlayerSeen({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
      return result;
    },
  );
}
export function readCentreReplay(input: Parameters<typeof engine.readCentreReplay>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.readReplay(input)));
}
export function applyCentreAction(input: Parameters<typeof engine.applyCentreAction>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.applyAction(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("centre", input.roomId).catch(() => undefined);
      if (result.ok && result.accepted && input.action.type === "player.leave") {
        await markGamePoolPlayerLeft({ roomId: input.roomId, playerId: input.playerId }).catch(
          () => undefined,
        );
        await publishMultiplayerRoomTermination("centre", input.roomId, {
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
          await publishMultiplayerRoomTermination("centre", input.roomId, {
            reason: "removed",
            playerId,
          }).catch(() => undefined);
      }
      return result;
    },
  );
}
export function authorizeCentreSocket(input: Parameters<typeof engine.authorizeCentreSocket>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.authorizeSocket(input)));
}
