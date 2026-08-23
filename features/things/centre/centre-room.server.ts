import {
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { CentreRoomService } from "./centre-room-service.server";
import type * as engine from "./centre-room-engine.server";

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
  return runMultiplayerEffect(CentreRoomService.use((service) => service.readSnapshot(input)));
}
export function readCentreReplay(input: Parameters<typeof engine.readCentreReplay>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.readReplay(input)));
}
export function applyCentreAction(input: Parameters<typeof engine.applyCentreAction>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.applyAction(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("centre", input.roomId).catch(() => undefined);
      return result;
    },
  );
}
export function authorizeCentreSocket(input: Parameters<typeof engine.authorizeCentreSocket>[0]) {
  return runMultiplayerEffect(CentreRoomService.use((service) => service.authorizeSocket(input)));
}
