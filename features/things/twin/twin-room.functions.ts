import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerText,
} from "../shared/multiplayer-validation";
import { TWIN_MAX_HAND, TWIN_MIN_HAND, TWIN_DEFAULT_HAND } from "./twin-deck";
import { TWIN_TIMING } from "./twin-rules";
import {
  applyTwinAction,
  createTwinRoom,
  joinTwinRoom,
  readTwinLog,
  readTwinSnapshot,
} from "./twin-room.server";

const record = multiplayerRecord;
const text = multiplayerText;
const credential = multiplayerCredential;

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid number");
  return Math.max(min, Math.min(max, Math.round(value)));
}

const identity = (data: Record<string, unknown>) => ({
  roomId: multiplayerRoomId(data.roomId),
  playerId: text(data.playerId, 80),
  playerToken: credential(data.playerToken),
});

export const createTwinRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      hostName: multiplayerBoundedText(data.hostName, 32, "Add your name").trim(),
      handSize: clampInteger(data.handSize, TWIN_MIN_HAND, TWIN_MAX_HAND, TWIN_DEFAULT_HAND),
      windowMs: clampInteger(
        data.windowMs,
        TWIN_TIMING.minWindowMs,
        TWIN_TIMING.maxWindowMs,
        TWIN_TIMING.defaultWindowMs,
      ),
      graceMs: clampInteger(
        data.graceMs,
        TWIN_TIMING.minGraceMs,
        TWIN_TIMING.maxGraceMs,
        TWIN_TIMING.defaultGraceMs,
      ),
    };
  })
  .handler(({ data }) => createTwinRoom(data));

export const joinTwinRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken),
      name: multiplayerBoundedText(data.name, 32, "Add your name").trim(),
    };
  })
  .handler(({ data }) => joinTwinRoom(data));

export const readTwinSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => identity(record(value)))
  .handler(({ data }) => readTwinSnapshot(data));

export const readTwinLogFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => identity(record(value)))
  .handler(({ data }) => readTwinLog(data));

export const applyTwinActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const raw = record(data.action);
    let action: Parameters<typeof applyTwinAction>[0]["action"];

    if (raw.type === "readiness.set" && typeof raw.ready === "boolean")
      action = { type: raw.type, ready: raw.ready };
    else if (raw.type === "answer.tap")
      action = {
        type: raw.type,
        heatId: text(raw.heatId, 80),
        symbolId: text(raw.symbolId, 40),
        // Bounded here as well as clamped in the rules, so nothing absurd reaches the engine.
        elapsedMs: clampInteger(raw.elapsedMs, 0, TWIN_TIMING.maxWindowMs, 0),
      };
    else if (raw.type === "game.start")
      action = {
        type: raw.type,
        removePlayerIds: Array.isArray(raw.removePlayerIds)
          ? raw.removePlayerIds.slice(0, 16).map((playerId) => text(playerId, 80))
          : undefined,
      };
    else if (raw.type === "game.configure")
      action = {
        type: raw.type,
        handSize:
          raw.handSize === undefined
            ? undefined
            : clampInteger(raw.handSize, TWIN_MIN_HAND, TWIN_MAX_HAND, TWIN_DEFAULT_HAND),
        windowMs:
          raw.windowMs === undefined
            ? undefined
            : clampInteger(
                raw.windowMs,
                TWIN_TIMING.minWindowMs,
                TWIN_TIMING.maxWindowMs,
                TWIN_TIMING.defaultWindowMs,
              ),
        graceMs:
          raw.graceMs === undefined
            ? undefined
            : clampInteger(
                raw.graceMs,
                TWIN_TIMING.minGraceMs,
                TWIN_TIMING.maxGraceMs,
                TWIN_TIMING.defaultGraceMs,
              ),
      };
    else if (raw.type === "game.replay" || raw.type === "game.lobby" || raw.type === "heat.next")
      action = { type: raw.type };
    else throw new Error("Invalid action");

    return { ...identity(data), action };
  })
  .handler(({ data }) => applyTwinAction(data));
