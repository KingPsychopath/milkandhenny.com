import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
} from "../shared/multiplayer-validation";
import { parseCentreRoute } from "./centre-trace";
import {
  applyCentreAction,
  createCentreRoom,
  joinCentreRoom,
  readCentreReplay,
  readCentreSnapshot,
} from "./centre-room.server";
import type { CentreDifficulty } from "./types";

const record = multiplayerRecord;
const text = multiplayerText;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;

function difficulty(value: unknown, fallback: CentreDifficulty = 3): CentreDifficulty {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5)
    throw new Error("Invalid difficulty");
  return value as CentreDifficulty;
}

const identity = (data: Record<string, unknown>) => ({
  roomId: multiplayerRoomId(data.roomId),
  playerId: text(data.playerId, 80),
  playerToken: credential(data.playerToken),
});

export const createCentreRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      hostName: multiplayerBoundedText(data.hostName, 32, "Add your name").trim(),
      difficulty: difficulty(data.difficulty),
      delayedRivals: data.delayedRivals === true,
    };
  })
  .handler(({ data }) => createCentreRoom(data));

export const joinCentreRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken),
      name: multiplayerBoundedText(data.name, 32, "Add your name").trim(),
    };
  })
  .handler(({ data }) => joinCentreRoom(data));

export const readCentreSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      ...identity(data),
      lastSequence: sequence(data.lastSequence),
      lastDigest: typeof data.lastDigest === "string" ? data.lastDigest.slice(0, 24) : null,
    };
  })
  .handler(({ data }) => readCentreSnapshot(data));

export const readCentreReplayFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => identity(record(value)))
  .handler(({ data }) => readCentreReplay(data));

export const applyCentreActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const raw = record(data.action);
    let action: Parameters<typeof applyCentreAction>[0]["action"];
    if (raw.type === "readiness.set" && typeof raw.ready === "boolean")
      action = { type: raw.type, ready: raw.ready };
    else if (raw.type === "arming.set" && typeof raw.armed === "boolean")
      action = { type: raw.type, armed: raw.armed };
    else if (raw.type === "game.configure")
      action = {
        type: raw.type,
        difficulty: raw.difficulty === undefined ? undefined : difficulty(raw.difficulty),
        delayedRivals:
          raw.delayedRivals === undefined
            ? undefined
            : typeof raw.delayedRivals === "boolean"
              ? raw.delayedRivals
              : (() => {
                  throw new Error("Invalid rival setting");
                })(),
      };
    else if (raw.type === "game.start")
      action = {
        type: raw.type,
        removePlayerIds: Array.isArray(raw.removePlayerIds)
          ? raw.removePlayerIds.slice(0, 8).map((playerId) => text(playerId, 80))
          : undefined,
      };
    else if (raw.type === "race.finish")
      action = {
        type: raw.type,
        courseHash: text(raw.courseHash, 24),
        route: parseCentreRoute(raw.route),
        claimedElapsedMs: Math.max(0, Math.min(300_000, sequence(raw.claimedElapsedMs))),
      };
    else if (raw.type === "race.progress" || raw.type === "race.retire")
      action = {
        type: raw.type,
        courseHash: text(raw.courseHash, 24),
        route: parseCentreRoute(raw.route),
      };
    else if (raw.type === "game.replay" || raw.type === "game.lobby") action = { type: raw.type };
    else if (raw.type === "player.leave") action = { type: raw.type };
    else throw new Error("Invalid action");
    return { ...identity(data), action };
  })
  .handler(({ data }) => applyCentreAction(data));
