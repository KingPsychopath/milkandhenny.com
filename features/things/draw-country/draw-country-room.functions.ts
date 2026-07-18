import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
} from "../shared/multiplayer-validation";
import {
  applyDrawCountryAction,
  createDrawCountryRoom,
  joinDrawCountryRoom,
  readDrawCountrySnapshot,
} from "./draw-country-room.server";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_RINGS,
  MAX_POINTS_PER_RING,
} from "./drawing-constraints";
import type { CountryDrawing, DrawPoint } from "./types";

const record = multiplayerRecord;
const text = multiplayerText;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;

function drawing(value: unknown): CountryDrawing {
  if (!Array.isArray(value) || value.length > MAX_DRAWING_RINGS) throw new Error("Invalid drawing");
  let total = 0;
  return value.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length > MAX_POINTS_PER_RING)
      throw new Error("Invalid drawing");
    total += candidate.length;
    if (total > MAX_DRAWING_POINTS) throw new Error("Drawing is too detailed");
    return candidate.map((raw): DrawPoint => {
      const point = record(raw);
      if (
        typeof point.x !== "number" ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > DRAWING_WIDTH ||
        point.y < 0 ||
        point.y > DRAWING_HEIGHT
      )
        throw new Error("Invalid point");
      return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
    });
  });
}

export const createDrawCountryRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      hostName: multiplayerBoundedText(data.hostName, 32, "Add your name").trim(),
      drawSeconds: Math.max(15, Math.min(90, sequence(data.drawSeconds ?? 30))),
      roundTotal: Math.max(1, Math.min(12, sequence(data.roundTotal ?? 5))),
      recentCountryIds: Array.isArray(data.recentCountryIds)
        ? data.recentCountryIds.slice(-36).map((id) => text(id, 2))
        : [],
    };
  })
  .handler(({ data }) => createDrawCountryRoom(data));

export const joinDrawCountryRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken),
      name: multiplayerBoundedText(data.name, 32, "Add your name").trim(),
    };
  })
  .handler(({ data }) => joinDrawCountryRoom(data));

export const readDrawCountrySnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: text(data.playerId, 80),
      playerToken: credential(data.playerToken),
    };
  })
  .handler(({ data }) => readDrawCountrySnapshot(data));

export const applyDrawCountryActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const rawAction = record(data.action);
    let action:
      | { type: "game.start"; removePlayerIds?: string[] }
      | { type: "readiness.set"; ready: boolean }
      | { type: "round.next" }
      | { type: "drawing.submit"; roundId: string; drawing: CountryDrawing };
    if (rawAction.type === "game.start")
      action = {
        type: rawAction.type,
        removePlayerIds: Array.isArray(rawAction.removePlayerIds)
          ? rawAction.removePlayerIds.slice(0, 16).map((playerId) => text(playerId, 80))
          : undefined,
      };
    else if (rawAction.type === "readiness.set" && typeof rawAction.ready === "boolean")
      action = { type: rawAction.type, ready: rawAction.ready };
    else if (rawAction.type === "round.next") action = { type: rawAction.type };
    else if (rawAction.type === "drawing.submit")
      action = {
        type: rawAction.type,
        roundId: text(rawAction.roundId, 80),
        drawing: drawing(rawAction.drawing),
      };
    else throw new Error("Invalid action");
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: text(data.playerId, 80),
      playerToken: credential(data.playerToken),
      action,
    };
  })
  .handler(({ data }) => applyDrawCountryAction(data));
