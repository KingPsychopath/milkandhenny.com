import { runMultiplayerEffect } from "../shared/multiplayer-runtime.server";
import { DrawCountryRoomService } from "./draw-country-room-service.server";
import type * as engine from "./draw-country-room-engine.server";

export function createDrawCountryRoom(input: Parameters<typeof engine.createDrawCountryRoom>[0]) {
  return runMultiplayerEffect(DrawCountryRoomService.use((service) => service.createRoom(input)));
}

export function joinDrawCountryRoom(input: Parameters<typeof engine.joinDrawCountryRoom>[0]) {
  return runMultiplayerEffect(DrawCountryRoomService.use((service) => service.joinRoom(input)));
}

export function readDrawCountrySnapshot(
  input: Parameters<typeof engine.readDrawCountrySnapshot>[0],
) {
  return runMultiplayerEffect(DrawCountryRoomService.use((service) => service.readSnapshot(input)));
}

export function applyDrawCountryAction(input: Parameters<typeof engine.applyDrawCountryAction>[0]) {
  return runMultiplayerEffect(DrawCountryRoomService.use((service) => service.applyAction(input)));
}

export function authorizeDrawCountrySocket(
  input: Parameters<typeof engine.authorizeDrawCountrySocket>[0],
) {
  return runMultiplayerEffect(
    DrawCountryRoomService.use((service) => service.authorizeSocket(input)),
  );
}
