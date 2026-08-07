import { createServerFn } from "@tanstack/react-start";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
} from "../shared/multiplayer-validation";
import { LIARS_LAST_WORDS_LENGTH, LIARS_ROLES } from "./liars-rules";
import {
  applyLiarsHostAction,
  applyLiarsPlayerAction,
  closeLiarsRoom,
  createLiarsRoom,
  joinLiarsRoom,
  readLiarsSnapshot,
} from "./liars-room.server";
import type {
  LiarsHostAction,
  LiarsLineup,
  LiarsMode,
  LiarsPlayerAction,
  LiarsRole,
  LiarsRoomMode,
  LiarsTimings,
  LiarsToggles,
} from "./types";

const record = multiplayerRecord;
const text = multiplayerText;
const roomId = multiplayerRoomId;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;
const actionId = (value: unknown) => text(value, 80);
const optionalId = (value: unknown) => (value === null || value === undefined ? null : text(value, 120));

function mode(value: unknown): LiarsMode {
  if (value === "mafia" || value === "imposter") return value;
  throw new Error("Invalid mode");
}

function roomMode(value: unknown): LiarsRoomMode {
  if (value === "same-room" || value === "remote") return value;
  throw new Error("Invalid room mode");
}

function role(value: unknown): LiarsRole {
  if (typeof value === "string" && value in LIARS_ROLES) return value as LiarsRole;
  throw new Error("Invalid role");
}

function lineup(value: unknown): LiarsLineup {
  const data = record(value);
  const roles = record(data.roles);
  const entries = Object.entries(roles).slice(0, 20);
  return {
    roles: Object.fromEntries(
      entries.map(([key, count]) => [role(key), Math.max(0, Math.min(16, sequence(count)))]),
    ),
  };
}

const TOGGLE_KEYS: Array<keyof LiarsToggles> = [
  "announceAttackTarget",
  "revealRoleOnDeath",
  "revealEjectedRole",
  "jesterEndsGame",
  "doctorRepeatTarget",
  "coldOpen",
  "blindImposters",
  "simultaneousClues",
  "cameraTorch",
  "lastWords",
  "graveyardVote",
  "liveGodView",
  "firstGame",
];

function toggles(value: unknown): Partial<LiarsToggles> {
  const data = record(value);
  const result: Partial<LiarsToggles> = {};
  for (const key of TOGGLE_KEYS) if (typeof data[key] === "boolean") result[key] = data[key];
  return result;
}

const TIMING_BOUNDS: Record<keyof LiarsTimings, [number, number]> = {
  deal: [10_000, 90_000],
  night: [20_000, 180_000],
  dawn: [8_000, 60_000],
  deliberation: [20_000, 600_000],
  vote: [10_000, 180_000],
  verdict: [5_000, 60_000],
  finalGuess: [10_000, 120_000],
  clueTurn: [15_000, 180_000],
};

function timings(value: unknown): Partial<LiarsTimings> {
  const data = record(value);
  const result: Partial<LiarsTimings> = {};
  for (const [key, [low, high]] of Object.entries(TIMING_BOUNDS) as Array<
    [keyof LiarsTimings, [number, number]]
  >) {
    if (data[key] === undefined) continue;
    result[key] = Math.max(low, Math.min(high, sequence(data[key])));
  }
  return result;
}

function hostAction(value: unknown): LiarsHostAction {
  const data = record(value);
  const id = actionId(data.actionId);
  if (data.type === "game.configure")
    return {
      actionId: id,
      type: data.type,
      ...(data.lineup === undefined ? {} : { lineup: lineup(data.lineup) }),
      ...(data.toggles === undefined ? {} : { toggles: toggles(data.toggles) }),
      ...(data.timings === undefined ? {} : { timings: timings(data.timings) }),
      ...(data.roomMode === undefined ? {} : { roomMode: roomMode(data.roomMode) }),
    };
  if (data.type === "player.remove")
    return { actionId: id, type: data.type, playerId: text(data.playerId, 120) };
  if (
    data.type === "game.start" ||
    data.type === "phase.extend" ||
    data.type === "phase.pause" ||
    data.type === "phase.resume" ||
    data.type === "game.replay" ||
    data.type === "game.lobby" ||
    data.type === "game.end"
  )
    return { actionId: id, type: data.type };
  throw new Error("Invalid action");
}

function playerAction(value: unknown): LiarsPlayerAction {
  const data = record(value);
  const id = actionId(data.actionId);
  if (data.type === "readiness.set" && typeof data.ready === "boolean")
    return { actionId: id, type: data.type, ready: data.ready };
  if (data.type === "host.claim") return { actionId: id, type: data.type };
  if (data.type === "words.last")
    return {
      actionId: id,
      type: data.type,
      text: multiplayerBoundedText(data.text, LIARS_LAST_WORDS_LENGTH, "Invalid last words"),
    };
  if (data.type === "guess.final")
    return {
      actionId: id,
      type: data.type,
      text: multiplayerBoundedText(data.text, 60, "Invalid guess"),
    };
  const round = sequence(data.round);
  if (data.type === "night.select")
    return { actionId: id, type: data.type, round, targetId: optionalId(data.targetId) };
  if (data.type === "night.lock" || data.type === "vote.lock" || data.type === "clue.said")
    return { actionId: id, type: data.type, round };
  if (data.type === "day.point")
    return { actionId: id, type: data.type, round, targetId: optionalId(data.targetId) };
  if (data.type === "day.readyToVote" && typeof data.ready === "boolean")
    return { actionId: id, type: data.type, round, ready: data.ready };
  if (data.type === "vote.cast")
    return { actionId: id, type: data.type, round, targetId: optionalId(data.targetId) };
  if (data.type === "graveyard.vote")
    return { actionId: id, type: data.type, round, targetId: optionalId(data.targetId) };
  throw new Error("Invalid action");
}

export const createLiarsRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      mode: mode(data.mode),
      roomMode: roomMode(data.roomMode ?? "same-room"),
      toggles: data.toggles === undefined ? undefined : toggles(data.toggles),
      timings: data.timings === undefined ? undefined : timings(data.timings),
    };
  })
  .handler(({ data }) => createLiarsRoom(data));

export const joinLiarsRoomFn = createServerFn({ method: "POST" })
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
  .handler(({ data }) => joinLiarsRoom(data));

export const readLiarsSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      credential: credential(data.credential),
      playerId: data.playerId === undefined ? undefined : text(data.playerId, 120),
      lastSequence: sequence(data.lastSequence),
    };
  })
  .handler(({ data }) => readLiarsSnapshot(data));

export const applyLiarsHostActionFn = createServerFn({ method: "POST" })
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
  .handler(({ data }) => applyLiarsHostAction(data));

export const applyLiarsPlayerActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: roomId(data.roomId),
      playerId: text(data.playerId, 120),
      playerToken: credential(data.playerToken),
      action: playerAction(data.action),
    };
  })
  .handler(({ data }) => applyLiarsPlayerAction(data));

export const closeLiarsRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), hostToken: credential(data.hostToken) };
  })
  .handler(({ data }) => closeLiarsRoom(data.roomId, data.hostToken));
