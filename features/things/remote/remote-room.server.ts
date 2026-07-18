import { RemoteRoomService } from "./remote-room-service.server";
import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";

import type * as engine from "./remote-room-engine.server";

export function authorizeRemoteSocket(input: Parameters<typeof engine.authorizeRemoteSocket>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.authorizeSocket(input)));
}

export function createRemoteRoom(input: Parameters<typeof engine.createRemoteRoom>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.createRoom(input)));
}

export function readRemotePlayerSetup(input: Parameters<typeof engine.readRemotePlayerSetup>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.readPlayerSetup(input)));
}

export function syncRemotePlayer(input: Parameters<typeof engine.syncRemotePlayer>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.syncPlayer(input)));
}

export function readRemoteJudge(input: Parameters<typeof engine.readRemoteJudge>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.readJudge(input)));
}

export function sendRemoteJudgeCommand(input: Parameters<typeof engine.sendRemoteJudgeCommand>[0]) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.sendJudgeCommand(input)));
}

export function closeRemoteRoom(...input: Parameters<typeof engine.closeRemoteRoom>) {
  return runMultiplayerEffect(RemoteRoomService.use((service) => service.closeRoom(...input)));
}
