import { createServerFn } from "@tanstack/react-start";
import {
  closeRemoteRoom,
  createRemoteRoom,
  readRemoteJudge,
  sendRemoteJudgeCommand,
  syncRemoteHost,
} from "./remote-room.server";
import type {
  RemoteCommand,
  RemoteGameKind,
  RemoteGameSnapshot,
  RemoteResultDecision,
} from "./types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

function shortText(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error("Invalid text");
  return value;
}

function roomId(value: unknown) {
  const id = shortText(value, 12).toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(id)) throw new Error("Invalid room");
  return id;
}

function token(value: unknown) {
  return shortText(value, 100);
}

function gameKind(value: unknown): RemoteGameKind {
  if (value === "heads-up" || value === "spelling-bee") return value;
  throw new Error("Invalid game");
}

function command(value: unknown): RemoteCommand {
  const data = record(value);
  const id = shortText(data.id, 80);
  const createdAt = typeof data.createdAt === "number" && Number.isFinite(data.createdAt) ? data.createdAt : NaN;
  if (!Number.isFinite(createdAt)) throw new Error("Invalid command time");
  if (data.type === "amend") {
    const decision = data.decision;
    if (decision !== "correct" && decision !== "incorrect" && decision !== "pass") throw new Error("Invalid decision");
    return { id, type: "amend", resultId: shortText(data.resultId, 80), decision, createdAt };
  }
  if (data.type === "correct" || data.type === "incorrect" || data.type === "pass" || data.type === "pause" || data.type === "resume" || data.type === "undo") {
    return { id, type: data.type, createdAt };
  }
  throw new Error("Invalid command");
}

function snapshot(value: unknown): RemoteGameSnapshot {
  const data = record(value);
  const game = gameKind(data.game);
  if (data.phase !== "setup" && data.phase !== "countdown" && data.phase !== "playing" && data.phase !== "results") throw new Error("Invalid phase");
  if (!Array.isArray(data.results) || data.results.length > 200) throw new Error("Invalid results");
  const results = data.results.map((value) => {
    const item = record(value);
    if (item.decision !== "correct" && item.decision !== "incorrect" && item.decision !== "pass") throw new Error("Invalid result");
    return {
      id: shortText(item.id, 80),
      label: shortText(item.label, 100),
      decision: item.decision as RemoteResultDecision,
      detail: typeof item.detail === "string" ? item.detail.slice(0, 200) : undefined,
    };
  });
  const optionalText = (field: unknown, max = 240) => typeof field === "string" ? field.slice(0, max) : undefined;
  return {
    game,
    phase: data.phase,
    deckName: shortText(data.deckName, 80),
    currentLabel: data.currentLabel === null ? null : shortText(data.currentLabel, 100),
    currentDefinition: optionalText(data.currentDefinition),
    currentPartOfSpeech: optionalText(data.currentPartOfSpeech, 40),
    nextLabel: data.nextLabel === null ? null : shortText(data.nextLabel, 100),
    secondsRemaining: data.secondsRemaining === null ? null : typeof data.secondsRemaining === "number" && data.secondsRemaining >= 0 && data.secondsRemaining <= 3600 ? data.secondsRemaining : null,
    paused: data.paused === true,
    pauseReason: optionalText(data.pauseReason, 100),
    score: typeof data.score === "number" && data.score >= 0 ? Math.floor(data.score) : 0,
    results,
    transcript: optionalText(data.transcript, 300),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

export const createRemoteRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => { const data = record(value); return { game: gameKind(data.game) }; })
  .handler(({ data }) => createRemoteRoom(data.game));

export const syncRemoteHostFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), hostToken: token(data.hostToken), snapshot: snapshot(data.snapshot), acknowledge: typeof data.acknowledge === "number" ? Math.max(0, Math.min(200, Math.floor(data.acknowledge))) : 0 };
  })
  .handler(({ data }) => syncRemoteHost(data));

export const readRemoteJudgeFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => { const data = record(value); return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken) }; })
  .handler(({ data }) => readRemoteJudge(data));

export const sendRemoteJudgeCommandFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => { const data = record(value); return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken), command: command(data.command) }; })
  .handler(({ data }) => sendRemoteJudgeCommand(data));

export const closeRemoteRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => { const data = record(value); return { roomId: roomId(data.roomId), hostToken: token(data.hostToken) }; })
  .handler(({ data }) => closeRemoteRoom(data.roomId, data.hostToken));
