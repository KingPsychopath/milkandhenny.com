import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
} from "../shared/multiplayer-validation";
import { SAME_BRAIN_MAX_ANSWER_LENGTH } from "./same-brain-rules";
import {
  applySameBrainHostAction,
  applySameBrainPlayerAction,
  closeSameBrainRoom,
  createSameBrainRoom,
  joinSameBrainRoom,
  readSameBrainSnapshot,
} from "./same-brain-room.server";
import {
  exportSameBrainRoom,
  forceSameBrainScore,
  importSameBrainRoom,
  reissueSameBrainHostToken,
  startSameBrainScenario,
  type SameBrainRoomExport,
} from "./same-brain-room-engine.server";
import type {
  SameBrainHostAction,
  SameBrainPlayerAction,
  SameBrainScoring,
  SameBrainTimings,
  SameBrainToggles,
} from "./types";

const record = multiplayerRecord;
const text = multiplayerText;
const roomId = multiplayerRoomId;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;
const actionId = (value: unknown) => text(value, 80);

function scoring(value: unknown): SameBrainScoring {
  if (value === "exact" || value === "embedding") return value;
  throw new Error("Invalid scoring method");
}

const TOGGLE_KEYS: Array<keyof SameBrainToggles> = [
  "sayItAloud",
  "eliminateOddOne",
  "showMachineWorking",
  "revealAuthors",
];

function toggles(value: unknown): Partial<SameBrainToggles> {
  const data = record(value);
  const result: Partial<SameBrainToggles> = {};
  for (const key of TOGGLE_KEYS) if (typeof data[key] === "boolean") result[key] = data[key];
  return result;
}

/** Bounds live in the rules; this only strips anything that is not a number. */
function timings(value: unknown): Partial<SameBrainTimings> {
  const data = record(value);
  const result: Partial<SameBrainTimings> = {};
  for (const key of ["prompt", "submit", "sayIt", "reveal"] as Array<keyof SameBrainTimings>)
    if (data[key] !== undefined) result[key] = sequence(data[key]);
  return result;
}

function hostAction(value: unknown): SameBrainHostAction {
  const data = record(value);
  const id = actionId(data.actionId);
  if (data.type === "game.configure")
    return {
      actionId: id,
      type: data.type,
      ...(data.rounds === undefined ? {} : { rounds: sequence(data.rounds) }),
      ...(data.scoring === undefined ? {} : { scoring: scoring(data.scoring) }),
      ...(data.toggles === undefined ? {} : { toggles: toggles(data.toggles) }),
      ...(data.timings === undefined ? {} : { timings: timings(data.timings) }),
    };
  if (data.type === "player.remove")
    return { actionId: id, type: data.type, playerId: text(data.playerId, 120) };
  if (data.type === "result.merge")
    return {
      actionId: id,
      type: data.type,
      round: sequence(data.round),
      from: sequence(data.from),
      to: sequence(data.to),
    };
  if (data.type === "result.reset")
    return { actionId: id, type: data.type, round: sequence(data.round) };
  if (data.type === "game.start")
    return { actionId: id, type: data.type, force: data.force === true };
  if (
    data.type === "game.skipQuestion" ||
    data.type === "phase.extend" ||
    data.type === "phase.advance" ||
    data.type === "phase.pause" ||
    data.type === "phase.resume" ||
    data.type === "game.replay" ||
    data.type === "game.lobby" ||
    data.type === "game.end"
  )
    return { actionId: id, type: data.type };
  throw new Error("Invalid action");
}

function playerAction(value: unknown): SameBrainPlayerAction {
  const data = record(value);
  const id = actionId(data.actionId);
  if (data.type === "readiness.set" && typeof data.ready === "boolean")
    return { actionId: id, type: data.type, ready: data.ready };
  if (data.type === "host.claim") return { actionId: id, type: data.type };
  if (data.type === "answer.submit")
    return {
      actionId: id,
      type: data.type,
      round: sequence(data.round),
      text: multiplayerBoundedText(data.text, SAME_BRAIN_MAX_ANSWER_LENGTH, "Invalid answer"),
    };
  if (data.type === "answer.clear")
    return { actionId: id, type: data.type, round: sequence(data.round) };
  throw new Error("Invalid action");
}

export const createSameBrainRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      rounds: data.rounds === undefined ? undefined : sequence(data.rounds),
      scoring: data.scoring === undefined ? undefined : scoring(data.scoring),
      toggles: data.toggles === undefined ? undefined : toggles(data.toggles),
      timings: data.timings === undefined ? undefined : timings(data.timings),
    };
  })
  .handler(({ data }) => createSameBrainRoom(data));

export const joinSameBrainRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken),
      name: text(data.name, 40),
      joinId: actionId(data.joinId),
      hostToken: data.hostToken === undefined ? undefined : credential(data.hostToken),
    };
  })
  .handler(({ data }) => joinSameBrainRoom(data));

export const readSameBrainSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      credential: credential(data.credential),
      playerId: data.playerId === undefined ? undefined : text(data.playerId, 120),
      lastSequence: sequence(data.lastSequence),
      lastDigest: typeof data.lastDigest === "string" ? data.lastDigest.slice(0, 24) : null,
    };
  })
  .handler(({ data }) => readSameBrainSnapshot(data));

export const applySameBrainHostActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      hostToken: data.hostToken === undefined ? undefined : credential(data.hostToken),
      playerId: data.playerId === undefined ? undefined : text(data.playerId, 120),
      playerToken: data.playerToken === undefined ? undefined : credential(data.playerToken),
      action: hostAction(data.action),
    };
  })
  .handler(({ data }) => applySameBrainHostAction(data));

export const applySameBrainPlayerActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      playerId: text(data.playerId, 120),
      playerToken: credential(data.playerToken),
      action: playerAction(data.action),
    };
  })
  .handler(({ data }) => applySameBrainPlayerAction(data));

export const closeSameBrainRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), hostToken: credential(data.hostToken) };
  })
  .handler(({ data }) => closeSameBrainRoom(data.roomId, data.hostToken));

// --- Development only. The engine refuses these outside development; these validate the input. ---

function devSeats(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map((entry) => {
    const seat = record(entry);
    return {
      name: text(seat.name, 40),
      playerId: text(seat.playerId, 120),
      playerToken: credential(seat.playerToken),
    };
  });
}

export const exportSameBrainRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      hostToken: credential(data.hostToken),
      seats: devSeats(data.seats),
    };
  })
  .handler(({ data }) => exportSameBrainRoom(data.roomId, data.hostToken, data.seats));

export const importSameBrainRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const captured = record(data.snapshot);
    if (captured.version !== 1) throw new Error("Unsupported capture");
    return {
      snapshot: {
        version: 1 as const,
        capturedAt: sequence(captured.capturedAt),
        room: multiplayerBoundedText(captured.room, 400_000, "Capture too large"),
        seats: devSeats(captured.seats),
      } satisfies SameBrainRoomExport,
    };
  })
  .handler(async ({ data }) => {
    const restored = await importSameBrainRoom(data.snapshot);
    if (!restored) return null;
    const hostToken = await reissueSameBrainHostToken(restored.roomId);
    return hostToken ? { ...restored, hostToken } : null;
  });

export const startSameBrainScenarioFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const names = Array.isArray(data.names) ? data.names.slice(0, 16).map((n) => text(n, 40)) : [];
    const answers = data.answers === undefined ? undefined : record(data.answers);
    return {
      names,
      rounds: data.rounds === undefined ? undefined : sequence(data.rounds),
      scoring: data.scoring === undefined ? undefined : scoring(data.scoring),
      toggles: data.toggles === undefined ? undefined : toggles(data.toggles),
      timings: data.timings === undefined ? undefined : timings(data.timings),
      question: data.question === undefined ? undefined : text(data.question, 140),
      answers: answers
        ? (Object.fromEntries(
            Object.entries(answers).map(([index, answer]) => [
              Number(index),
              multiplayerBoundedText(answer, SAME_BRAIN_MAX_ANSWER_LENGTH, "Invalid answer"),
            ]),
          ) as Record<number, string>)
        : undefined,
    };
  })
  .handler(({ data }) => startSameBrainScenario(data));

export const forceSameBrainScoreFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => ({ roomId: roomId(record(value).roomId) }))
  .handler(({ data }) => forceSameBrainScore(data.roomId));
