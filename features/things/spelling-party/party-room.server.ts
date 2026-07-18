import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";
import { PartyRoomService } from "./party-room-service.server";

import type * as engine from "./party-room-engine.server";

export function authorizePartySocket(input: Parameters<typeof engine.authorizePartySocket>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.authorizeSocket(input)));
}

export function createPartyRoom(input: Parameters<typeof engine.createPartyRoom>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.createRoom(input)));
}

export function joinPartyRoom(input: Parameters<typeof engine.joinPartyRoom>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.joinRoom(input)));
}

export function readPartySnapshot(input: Parameters<typeof engine.readPartySnapshot>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.readSnapshot(input)));
}

export function applyPresenterAction(input: Parameters<typeof engine.applyPresenterAction>[0]) {
  return runMultiplayerEffect(
    PartyRoomService.use((service) => service.applyPresenterAction(input)),
  );
}

export function applyPlayerAction(input: Parameters<typeof engine.applyPlayerAction>[0]) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.applyPlayerAction(input)));
}

export function getPartyAudioAsset(...input: Parameters<typeof engine.getPartyAudioAsset>) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.getAudioAsset(...input)));
}

export function closePartyRoom(...input: Parameters<typeof engine.closePartyRoom>) {
  return runMultiplayerEffect(PartyRoomService.use((service) => service.closeRoom(...input)));
}
