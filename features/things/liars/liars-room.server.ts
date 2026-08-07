import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";
import { LiarsRoomService } from "./liars-room-service.server";

import type * as engine from "./liars-room-engine.server";

export function authorizeLiarsSocket(input: Parameters<typeof engine.authorizeLiarsSocket>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.authorizeSocket(input)));
}

export function createLiarsRoom(input: Parameters<typeof engine.createLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.createRoom(input)));
}

export function joinLiarsRoom(input: Parameters<typeof engine.joinLiarsRoom>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.joinRoom(input)));
}

export function readLiarsSnapshot(input: Parameters<typeof engine.readLiarsSnapshot>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.readSnapshot(input)));
}

export function applyLiarsHostAction(input: Parameters<typeof engine.applyLiarsHostAction>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.applyHostAction(input)));
}

export function applyLiarsPlayerAction(input: Parameters<typeof engine.applyLiarsPlayerAction>[0]) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.applyPlayerAction(input)));
}

export function closeLiarsRoom(...input: Parameters<typeof engine.closeLiarsRoom>) {
  return runMultiplayerEffect(LiarsRoomService.use((service) => service.closeRoom(...input)));
}
