import {
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { TwinRoomService } from "./twin-room-service.server";
import type * as engine from "./twin-room-engine.server";

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
  return runMultiplayerEffect(TwinRoomService.use((service) => service.readSnapshot(input)));
}

export function readTwinLog(input: Parameters<typeof engine.readTwinLog>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.readLog(input)));
}

export function applyTwinAction(input: Parameters<typeof engine.applyTwinAction>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.applyAction(input))).then(
    async (result) => {
      await publishMultiplayerRoomWake("twin", input.roomId).catch(() => undefined);
      return result;
    },
  );
}

export function authorizeTwinSocket(input: Parameters<typeof engine.authorizeTwinSocket>[0]) {
  return runMultiplayerEffect(TwinRoomService.use((service) => service.authorizeSocket(input)));
}
