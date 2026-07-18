import { PairedGameRoomService } from "./paired-game-room-service.server";
import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";

import type * as engine from "./paired-game-room-engine.server";

export function authorizePairedGameSocket(input: Parameters<typeof engine.authorizePairedGameSocket>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.authorizeSocket(input)));
}

export function createPairedGameRoom(input: Parameters<typeof engine.createPairedGameRoom>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.createRoom(input)));
}

export function readPairedGamePlayerSetup(input: Parameters<typeof engine.readPairedGamePlayerSetup>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.readPlayerSetup(input)));
}

export function syncPairedGamePlayer(input: Parameters<typeof engine.syncPairedGamePlayer>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.syncPlayer(input)));
}

export function readPairedGameJudge(input: Parameters<typeof engine.readPairedGameJudge>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.readJudge(input)));
}

export function sendPairedGameJudgeCommand(input: Parameters<typeof engine.sendPairedGameJudgeCommand>[0]) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.sendJudgeCommand(input)));
}

export function closePairedGameRoom(...input: Parameters<typeof engine.closePairedGameRoom>) {
  return runMultiplayerEffect(PairedGameRoomService.use((service) => service.closeRoom(...input)));
}
