import { createServerFn } from "@tanstack/react-start";
import {
  closeRemoteRoom,
  createRemoteRoom,
  readRemoteJudge,
  readRemotePlayerSetup,
  sendRemoteJudgeCommand,
  syncRemotePlayer,
} from "./remote-room.server";
import type {
  RemoteCommandRequest,
  RemoteGameKind,
  RemoteGameSetup,
  RemoteGameSnapshot,
  RemoteSyncedSnapshot,
  RemoteResultDecision,
  RemoteRoomRole,
} from "./types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

function shortText(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error("Invalid text");
  return value;
}

function optionalText(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
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

function roomRole(value: unknown): RemoteRoomRole {
  if (value === "player" || value === "judge") return value;
  throw new Error("Invalid role");
}

function boundedList(value: unknown, min: number, max: number) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error("Invalid deck");
  return value;
}

export function remoteGameSetup(value: unknown): RemoteGameSetup {
  const data = record(value);
  const game = gameKind(data.game);
  const deck = record(data.deck);
  const name = shortText(deck.name, 80);
  if (game === "heads-up") {
    const cards = boundedList(deck.cards, 3, 200).map((card) => shortText(card, 100));
    return { game, deck: { name, cards }, positionLock: data.positionLock === true };
  }
  const words = boundedList(deck.words, 3, 200).map((value) => {
    const item = record(value);
    return {
      id: shortText(item.id, 100),
      word: shortText(item.word, 100),
      partOfSpeech: optionalText(item.partOfSpeech, 40),
      definition: optionalText(item.definition, 240),
      speakAs: optionalText(item.speakAs, 120),
    };
  });
  const timerSeconds = typeof data.timerSeconds === "number" && Number.isInteger(data.timerSeconds)
    ? Math.max(0, Math.min(60, data.timerSeconds))
    : 30;
  return { game, deck: { name, words }, timerSeconds, autoSpeak: data.autoSpeak !== false };
}

function command(value: unknown): RemoteCommandRequest {
  const data = record(value);
  const id = shortText(data.id, 80);
  const target = { roundId: shortText(data.roundId, 80), itemId: shortText(data.itemId, 120) };
  const createdAt = typeof data.createdAt === "number" && Number.isFinite(data.createdAt) ? data.createdAt : NaN;
  if (!Number.isFinite(createdAt)) throw new Error("Invalid command time");
  if (data.type === "amend") {
    const decision = data.decision;
    if (decision !== "correct" && decision !== "incorrect" && decision !== "pass") throw new Error("Invalid decision");
    return { id, type: "amend", resultId: shortText(data.resultId, 80), decision, createdAt, ...target };
  }
  if (data.type === "correct" || data.type === "incorrect" || data.type === "pass" || data.type === "pause" || data.type === "resume" || data.type === "undo") {
    return { id, type: data.type, createdAt, ...target };
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
      detail: optionalText(item.detail, 200),
    };
  });
  return {
    game,
    phase: data.phase,
    deckName: shortText(data.deckName, 80),
    currentLabel: data.currentLabel === null ? null : shortText(data.currentLabel, 100),
    currentDefinition: optionalText(data.currentDefinition, 240),
    currentPartOfSpeech: optionalText(data.currentPartOfSpeech, 40),
    nextLabel: data.nextLabel === null ? null : shortText(data.nextLabel, 100),
    secondsRemaining: data.secondsRemaining === null ? null : typeof data.secondsRemaining === "number" && data.secondsRemaining >= 0 && data.secondsRemaining <= 3600 ? data.secondsRemaining : null,
    paused: data.paused === true,
    transitioning: data.transitioning === true,
    pauseReason: optionalText(data.pauseReason, 100),
    score: typeof data.score === "number" && data.score >= 0 ? Math.floor(data.score) : 0,
    results,
    transcript: optionalText(data.transcript, 300),
    itemKey: optionalText(data.itemKey, 120),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

function syncedSnapshot(value: unknown): RemoteSyncedSnapshot {
  const data = record(value);
  const base = snapshot(value);
  if (!Array.isArray(data.commandReceipts) || data.commandReceipts.length > 20) throw new Error("Invalid receipts");
  return {
    ...base,
    roundId: data.roundId === null ? null : shortText(data.roundId, 80),
    itemId: data.itemId === null ? null : shortText(data.itemId, 120),
    revision: typeof data.revision === "number" && Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
    connectionEpoch: shortText(data.connectionEpoch, 80),
    commandReceipts: data.commandReceipts.map((value) => {
      const receipt = record(value);
      if (receipt.status !== "applied" && receipt.status !== "rejected") throw new Error("Invalid receipt");
      const reason = receipt.reason === "stale round" || receipt.reason === "stale item" ? receipt.reason : undefined;
      return {
        commandId: shortText(receipt.commandId, 80),
        sequence: typeof receipt.sequence === "number" ? Math.max(0, Math.floor(receipt.sequence)) : 0,
        status: receipt.status,
        reason,
      };
    }),
  };
}

export const createRemoteRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { creatorRole: roomRole(data.creatorRole), setup: remoteGameSetup(data.setup) };
  })
  .handler(({ data }) => createRemoteRoom(data));

export const readRemotePlayerSetupFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), playerToken: token(data.playerToken) };
  })
  .handler(({ data }) => readRemotePlayerSetup(data));

export const syncRemotePlayerFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), playerToken: token(data.playerToken), snapshot: syncedSnapshot(data.snapshot), lastCommandSequence: typeof data.lastCommandSequence === "number" ? Math.max(0, Math.floor(data.lastCommandSequence)) : 0 };
  })
  .handler(({ data }) => syncRemotePlayer(data));

export const readRemoteJudgeFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken) };
  })
  .handler(({ data }) => readRemoteJudge(data));

export const sendRemoteJudgeCommandFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken), command: command(data.command) };
  })
  .handler(({ data }) => sendRemoteJudgeCommand(data));

export const closeRemoteRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), role: roomRole(data.role), token: token(data.token) };
  })
  .handler(({ data }) => closeRemoteRoom(data.roomId, data.role, data.token));
