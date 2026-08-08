import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";
import { SameBrainRoomService } from "./same-brain-room-service.server";

import type * as engine from "./same-brain-room-engine.server";

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
  return runMultiplayerEffect(SameBrainRoomService.use((service) => service.joinRoom(input)));
}

export function readSameBrainSnapshot(input: Parameters<typeof engine.readSameBrainSnapshot>[0]) {
  return runMultiplayerEffect(SameBrainRoomService.use((service) => service.readSnapshot(input)));
}

export function applySameBrainHostAction(
  input: Parameters<typeof engine.applySameBrainHostAction>[0],
) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.applyHostAction(input)),
  );
}

export function applySameBrainPlayerAction(
  input: Parameters<typeof engine.applySameBrainPlayerAction>[0],
) {
  return runMultiplayerEffect(
    SameBrainRoomService.use((service) => service.applyPlayerAction(input)),
  );
}

export function closeSameBrainRoom(...input: Parameters<typeof engine.closeSameBrainRoom>) {
  return runMultiplayerEffect(SameBrainRoomService.use((service) => service.closeRoom(...input)));
}
