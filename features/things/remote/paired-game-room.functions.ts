import { createServerFn } from "@tanstack/react-start";
import { multiplayerCredential, multiplayerRecord, multiplayerRoomId, multiplayerText, optionalMultiplayerText } from "../shared/multiplayer-validation";
import {
  closePairedGameRoom,
  createPairedGameRoom,
  readPairedGameJudge,
  readPairedGamePlayerSetup,
  sendPairedGameJudgeCommand,
  syncPairedGamePlayer,
} from "./paired-game-room.server";
import type {
  RemoteCommandRequest,
  RemoteGameKind,
  RemoteGameSetup,
  RemoteGameSnapshot,
  RemoteResultDecision,
  RemoteSyncedSnapshot,
  PairedGameRoomRole,
} from "./types";

const record = multiplayerRecord;
const shortText = multiplayerText;
const optionalText = optionalMultiplayerText;
const roomId = multiplayerRoomId;
const token = (value: unknown) => multiplayerCredential(value, 100);

function gameKind(value: unknown): RemoteGameKind {
  if (value === "heads-up" || value === "spelling-bee") return value;
  throw new Error("Invalid game");
}

function roomRole(value: unknown): PairedGameRoomRole {
  if (value === "player" || value === "judge") return value;
  throw new Error("Invalid role");
}

function resultDecision(value: unknown): RemoteResultDecision {
  if (
    value === "correct" ||
    value === "incorrect" ||
    value === "pass" ||
    value === "skipped" ||
    value === "timed_out"
  )
    return value;
  throw new Error("Invalid decision");
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
  const roundWordCount = typeof data.roundWordCount === "number" && Number.isInteger(data.roundWordCount)
    ? Math.max(1, Math.min(words.length, data.roundWordCount))
    : Math.min(5, words.length);
  return { game, deck: { name, words }, timerSeconds, roundWordCount, autoSpeak: data.autoSpeak !== false };
}

function command(value: unknown): RemoteCommandRequest {
  const data = record(value);
  const id = shortText(data.id, 80);
  const target = { roundId: shortText(data.roundId, 80), itemId: shortText(data.itemId, 120) };
  const createdAt = typeof data.createdAt === "number" && Number.isFinite(data.createdAt) ? data.createdAt : NaN;
  if (!Number.isFinite(createdAt)) throw new Error("Invalid command time");
  if (data.type === "amend") {
    const decision = data.decision;
    if (decision !== "correct" && decision !== "incorrect" && decision !== "pass" && decision !== "skipped" && decision !== "timed_out") throw new Error("Invalid decision");
    return { id, type: "amend", resultId: shortText(data.resultId, 80), decision, createdAt, ...target };
  }
  if (data.type === "correct" || data.type === "incorrect" || data.type === "pass" || data.type === "skip" || data.type === "pause" || data.type === "resume" || data.type === "undo") {
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
    return {
      id: shortText(item.id, 80),
      label: shortText(item.label, 100),
      decision: resultDecision(item.decision),
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
    decisionClosesAt: typeof data.decisionClosesAt === "number" && Number.isFinite(data.decisionClosesAt) ? data.decisionClosesAt : undefined,
    decisionGraceEndsAt: typeof data.decisionGraceEndsAt === "number" && Number.isFinite(data.decisionGraceEndsAt) ? data.decisionGraceEndsAt : undefined,
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
      const reason =
        receipt.reason === "stale_round" ||
        receipt.reason === "stale_item" ||
        receipt.reason === "decision_closed" ||
        receipt.reason === "already_decided"
          ? receipt.reason
          : undefined;
      return {
        commandId: shortText(receipt.commandId, 80),
        sequence: typeof receipt.sequence === "number" ? Math.max(0, Math.floor(receipt.sequence)) : 0,
        status: receipt.status,
        reason,
      };
    }),
  };
}

export const createPairedGameRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { creatorRole: roomRole(data.creatorRole), setup: remoteGameSetup(data.setup) };
  })
  .handler(({ data }) => createPairedGameRoom(data));

export const readPairedGamePlayerSetupFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), playerToken: token(data.playerToken) };
  })
  .handler(({ data }) => readPairedGamePlayerSetup(data));

export const syncPairedGamePlayerFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), playerToken: token(data.playerToken), snapshot: syncedSnapshot(data.snapshot), lastCommandSequence: typeof data.lastCommandSequence === "number" ? Math.max(0, Math.floor(data.lastCommandSequence)) : 0 };
  })
  .handler(({ data }) => syncPairedGamePlayer(data));

export const readPairedGameJudgeFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken), judgeEpoch: shortText(data.judgeEpoch, 80), takeover: data.takeover === true };
  })
  .handler(({ data }) => readPairedGameJudge(data));

export const sendPairedGameJudgeCommandFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), judgeToken: token(data.judgeToken), judgeEpoch: shortText(data.judgeEpoch, 80), command: command(data.command) };
  })
  .handler(({ data }) => sendPairedGameJudgeCommand(data));

export const closePairedGameRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), role: roomRole(data.role), token: token(data.token) };
  })
  .handler(({ data }) => closePairedGameRoom(data.roomId, data.role, data.token));
