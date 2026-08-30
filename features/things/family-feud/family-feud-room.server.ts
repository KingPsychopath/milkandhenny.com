import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
  runMultiplayerEffect,
} from "../shared/multiplayer-runtime.server";
import { FamilyFeudRoomService } from "./family-feud-room-service.server";

import type * as engine from "./family-feud-room-engine.server";

export function authorizeFamilyFeudSocket(
  input: Parameters<typeof engine.authorizeFamilyFeudSocket>[0],
) {
  return runMultiplayerEffect(
    FamilyFeudRoomService.use((service) => service.authorizeSocket(input)),
  );
}

export function createFamilyFeudRoom(input: Parameters<typeof engine.createFamilyFeudRoom>[0]) {
  return runMultiplayerEffect(FamilyFeudRoomService.use((service) => service.createRoom(input)));
}

export function readFamilyFeudSnapshot(input: Parameters<typeof engine.readFamilyFeudSnapshot>[0]) {
  return runMultiplayerEffect(FamilyFeudRoomService.use((service) => service.readSnapshot(input)));
}

export function pairFamilyFeudController(
  input: Parameters<typeof engine.pairFamilyFeudController>[0],
) {
  return runMultiplayerEffect(
    FamilyFeudRoomService.use((service) => service.pairController(input)),
  ).then(async (result) => {
    if (result.ok)
      await publishMultiplayerRoomWake("family-feud", input.roomId).catch(() => undefined);
    return result;
  });
}

export function applyFamilyFeudControllerAction(
  input: Parameters<typeof engine.applyFamilyFeudControllerAction>[0],
) {
  return runMultiplayerEffect(
    FamilyFeudRoomService.use((service) => service.applyControllerAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("family-feud", input.roomId).catch(() => undefined);
    return result;
  });
}

export function applyFamilyFeudBuzzerAction(
  input: Parameters<typeof engine.applyFamilyFeudBuzzerAction>[0],
) {
  return runMultiplayerEffect(
    FamilyFeudRoomService.use((service) => service.applyBuzzerAction(input)),
  ).then(async (result) => {
    await publishMultiplayerRoomWake("family-feud", input.roomId).catch(() => undefined);
    return result;
  });
}

export function closeFamilyFeudRoom(...input: Parameters<typeof engine.closeFamilyFeudRoom>) {
  return runMultiplayerEffect(
    FamilyFeudRoomService.use((service) => service.closeRoom(...input)),
  ).then(async (result) => {
    if (result.ok)
      await publishMultiplayerRoomTermination("family-feud", input[0], {
        reason: "room_closed",
      }).catch(() => undefined);
    return result;
  });
}
