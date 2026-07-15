import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { partyRoomRedisKeys } from "../shared/game-keys";
import { partyAudioAssetKey, partyDeck, type PartyWord } from "./party-content.server";
import { rankSpellingAnswers } from "./spelling-closeness";
import type {
  PartyActionResult,
  PartyClueEvent,
  PartyClueKind,
  PartyCustomDeckInput,
  PartyPlayerAction,
  PartyPlayerCredentials,
  PartyPresenterAction,
  PartyRole,
  PartyRoomCredentials,
  PartySnapshot,
  PartySnapshotResult,
} from "./types";

const ROOM_TTL_SECONDS = 4 * 60 * 60;
const FINISHED_GRACE_SECONDS = 15 * 60;
const JOIN_RECEIPT_TTL_SECONDS = 2 * 60;
const CONNECTED_WINDOW_MS = 22_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface AudioCapability { id: string; key: string }
interface PlayerState {
  id: string; name: string; tokenHash: string; score: number; draft: string; draftRevision: number;
  locked: boolean; automatic: boolean; lockedAt: number | null; lastSeenAt: number; integrityRoundIds: string[];
}
interface RoundState {
  roundId: string; number: number; wordId: string; countdownStartsAt: number; audioPlaysAt: number;
  answerOpensAt: number; answerLocksAt: number; revealAt: number; wordAudio: AudioCapability | null;
  repeatUsed: boolean; definitionUsed: boolean; activeClue: PartyClueEvent | null; clueCapabilities: AudioCapability[]; scored: boolean;
}
interface JoinReceipt { playerId: string; playerToken: string; expiresAt: number }
interface PartyRoomState {
  roomId: string; deckId: string; deckName: string; answerSeconds: number; roundTotal: number; wordIds: string[];
  words?: PartyWord[]; usesLocalSpeech?: boolean;
  phase: "lobby" | "countdown" | "answer" | "locked" | "reveal" | "finished";
  revision: number; sequence: number; presenterHash: string; joinHash: string; expiresAt: number; sentenceCluesRemaining: number;
  players: PlayerState[]; round: RoundState | null; recentClues: PartyClueEvent[]; processedActions: string[];
  joinReceiptIds: string[];
  joinReceipts?: Record<string, Omit<JoinReceipt, "expiresAt">>;
}

const memoryRooms = new Map<string, PartyRoomState>();
const memoryJoinReceipts = new Map<string, JoinReceipt>();

type PartyRedisKeys = ReturnType<typeof partyRoomRedisKeys>;
interface LoadedRoom { room: PartyRoomState; keys: PartyRedisKeys }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function token() { return randomBytes(24).toString("base64url"); }
function capability() { return randomBytes(18).toString("base64url"); }
function roomId() { return Array.from(randomBytes(7), (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join(""); }
function safeEqual(value: string, expectedHash: string) {
  if (!value || value.length > 120 || expectedHash.length !== 64) return false;
  const left = Buffer.from(hash(value), "hex");
  const right = Buffer.from(expectedHash, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function changed(room: PartyRoomState) { room.revision += 1; room.sequence += 1; }
function normalizeAnswer(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US"); }

function remainingTtlSeconds(expiresAt: number) {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000));
}

function memoryReceiptKey(roomIdValue: string, joinId: string) {
  return `${roomIdValue}:${joinId}`;
}

async function migrateLegacyJoinReceipts(room: PartyRoomState, keys: PartyRedisKeys) {
  room.joinReceiptIds ??= [];
  if (!room.joinReceipts) return false;
  const expiresAt = Math.min(room.expiresAt, Date.now() + JOIN_RECEIPT_TTL_SECONDS * 1_000);
  const redis = getRedis();
  const knownReceiptIds = new Set(room.joinReceiptIds);
  for (const [joinId, receipt] of Object.entries(room.joinReceipts)) {
    const next = { ...receipt, expiresAt };
    if (!knownReceiptIds.has(joinId)) {
      knownReceiptIds.add(joinId);
      room.joinReceiptIds.push(joinId);
    }
    if (redis) await redis.set(keys.joinReceipt(joinId), next, { ex: remainingTtlSeconds(expiresAt) });
    else memoryJoinReceipts.set(memoryReceiptKey(room.roomId, joinId), next);
  }
  delete room.joinReceipts;
  return true;
}

function hydrateRoomWords(room: PartyRoomState) {
  room.words ??= partyDeck(room.deckId)?.words ?? [];
  room.usesLocalSpeech ??= false;
}

async function deletePartyRoom(room: PartyRoomState, keys: PartyRedisKeys) {
  const redis = getRedis();
  if (redis) {
    await redis.del(keys.state, keys.lock, ...room.joinReceiptIds.map((joinId) => keys.joinReceipt(joinId)));
  } else {
    memoryRooms.delete(room.roomId);
    for (const joinId of room.joinReceiptIds) memoryJoinReceipts.delete(memoryReceiptKey(room.roomId, joinId));
  }
}

async function loadRoom(id: string): Promise<LoadedRoom | null> {
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(id) ?? null;
    if (!room) return null;
    room.joinReceiptIds ??= [];
    hydrateRoomWords(room);
    if (room.expiresAt <= Date.now()) {
      await deletePartyRoom(room, partyRoomRedisKeys(id));
      return null;
    }
    await migrateLegacyJoinReceipts(room, partyRoomRedisKeys(id));
    return { room, keys: partyRoomRedisKeys(id) };
  }
  for (const keys of [partyRoomRedisKeys(id), partyRoomRedisKeys(id, true)]) {
    const room = await redis.get<PartyRoomState>(keys.state);
    if (!room) continue;
    room.joinReceiptIds ??= [];
    hydrateRoomWords(room);
    if (room.expiresAt <= Date.now()) {
      await deletePartyRoom(room, keys);
      return null;
    }
    if (await migrateLegacyJoinReceipts(room, keys)) {
      await redis.set(keys.state, room, { ex: remainingTtlSeconds(room.expiresAt) });
    }
    return { room, keys };
  }
  return null;
}

async function saveRoom(room: PartyRoomState, keys = partyRoomRedisKeys(room.roomId)) {
  const redis = getRedis();
  if (room.expiresAt <= Date.now()) {
    await deletePartyRoom(room, keys);
    return;
  }
  if (redis) await redis.set(keys.state, room, { ex: remainingTtlSeconds(room.expiresAt) });
  else memoryRooms.set(room.roomId, room);
}

async function withRoom<T>(id: string, use: (room: PartyRoomState, keys: PartyRedisKeys) => T | Promise<T>): Promise<T | null> {
  const redis = getRedis();
  if (!redis) {
    const loaded = await loadRoom(id);
    if (!loaded) return null;
    const result = await use(loaded.room, loaded.keys);
    await saveRoom(loaded.room, loaded.keys);
    return result;
  }
  const initial = await loadRoom(id);
  if (!initial) return null;
  const owner = token();
  let acquired = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    acquired = Boolean(await redis.set(initial.keys.lock, owner, { nx: true, px: 5_000 }));
    if (acquired) break;
    await new Promise((resolve) => setTimeout(resolve, 20 + randomInt(25)));
  }
  if (!acquired) throw new Error("Room is busy");
  try {
    const room = await redis.get<PartyRoomState>(initial.keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    room.joinReceiptIds ??= [];
    const result = await use(room, initial.keys);
    await saveRoom(room, initial.keys);
    return result;
  } finally {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [initial.keys.lock], [owner]);
  }
}

async function readJoinReceipt(roomIdValue: string, joinId: string, keys: PartyRedisKeys) {
  const redis = getRedis();
  const receipt = redis
    ? await redis.get<JoinReceipt>(keys.joinReceipt(joinId))
    : memoryJoinReceipts.get(memoryReceiptKey(roomIdValue, joinId)) ?? null;
  if (!receipt || receipt.expiresAt <= Date.now()) {
    if (redis) await redis.del(keys.joinReceipt(joinId));
    else memoryJoinReceipts.delete(memoryReceiptKey(roomIdValue, joinId));
    return null;
  }
  return receipt;
}

async function writeJoinReceipt(room: PartyRoomState, joinId: string, receipt: JoinReceipt, keys: PartyRedisKeys) {
  if (!room.joinReceiptIds.includes(joinId)) room.joinReceiptIds.push(joinId);
  const redis = getRedis();
  if (redis) await redis.set(keys.joinReceipt(joinId), receipt, { ex: remainingTtlSeconds(receipt.expiresAt) });
  else memoryJoinReceipts.set(memoryReceiptKey(room.roomId, joinId), receipt);
}

function wordFor(room: PartyRoomState): PartyWord | null {
  const id = room.round?.wordId;
  return room.words?.find((word) => word.id === id) ?? null;
}

function lockAll(room: PartyRoomState, now: number) {
  for (const player of room.players) {
    if (player.locked) continue;
    player.locked = true;
    player.automatic = true;
    player.lockedAt = now;
  }
  if (room.round) {
    room.round.answerLocksAt = Math.min(room.round.answerLocksAt, now);
    room.round.revealAt = now + 650;
  }
  room.phase = "locked";
  changed(room);
}

function reveal(room: PartyRoomState) {
  const word = wordFor(room);
  if (!room.round || !word) return;
  if (!room.round.scored) {
    for (const player of room.players) {
      if (normalizeAnswer(player.draft) === normalizeAnswer(word.word)) player.score += 1;
    }
    room.round.scored = true;
  }
  room.phase = "reveal";
  changed(room);
}

function advance(room: PartyRoomState, now = Date.now()) {
  const round = room.round;
  if (!round) return;
  if (room.phase === "countdown" && now >= round.answerOpensAt) { room.phase = "answer"; changed(room); }
  if (room.phase === "answer" && now >= round.answerLocksAt) lockAll(room, round.answerLocksAt);
  if (room.phase === "locked" && now >= round.revealAt) reveal(room);
}

function audioUrl(roomIdValue: string, assetId: string) {
  return `/api/things/party-audio/${roomIdValue}/${assetId}`;
}

function clueForRole(clue: PartyClueEvent | null, role: PartyRole) {
  if (!clue || role === "presenter" || !clue.speechText) return clue;
  const { speechText: _, ...publicClue } = clue;
  return publicClue;
}

function snapshot(room: PartyRoomState, role: PartyRole, playerId?: string): PartySnapshot {
  advance(room);
  const now = Date.now();
  const word = wordFor(room);
  const revealed = room.phase === "reveal" || room.phase === "finished";
  const currentPlayer = role === "player" ? room.players.find(({ id }) => id === playerId) : undefined;
  return {
    roomId: room.roomId,
    deckName: room.deckName,
    phase: room.phase,
    revision: room.revision,
    sequence: room.sequence,
    serverNow: now,
    answerSeconds: room.answerSeconds,
    players: room.players.map((player) => {
      const connected = now - player.lastSeenAt <= CONNECTED_WINDOW_MS;
      return {
        id: player.id,
        name: player.name,
        status: connected ? (player.locked ? "locked" : player.draft ? "typing" : "ready") : "disconnected",
        score: player.score,
        connected,
        integrityNotices: player.integrityRoundIds.length,
      };
    }),
    round: room.round ? {
      roundId: room.round.roundId,
      number: room.round.number,
      total: room.roundTotal,
      countdownStartsAt: room.round.countdownStartsAt,
      audioPlaysAt: room.round.audioPlaysAt,
      answerOpensAt: room.round.answerOpensAt,
      answerLocksAt: room.round.answerLocksAt,
      revealAt: room.round.revealAt,
      wordAudioUrl: room.round.wordAudio ? audioUrl(room.roomId, room.round.wordAudio.id) : null,
      ...(role === "presenter" ? {
        ...(room.usesLocalSpeech && word ? { spokenWord: word.speakAs ?? word.word } : {}),
        speechLocale: room.deckId === "american-english" ? "en-US" as const : "en-GB" as const,
      } : {}),
      activeClue: clueForRole(room.round.activeClue, role),
      repeatUsed: room.round.repeatUsed,
      definitionUsed: room.round.definitionUsed,
      sentenceCluesRemaining: room.sentenceCluesRemaining,
      ...(revealed && word ? {
        correctWord: word.word,
        answers: rankSpellingAnswers(room.players.map((player) => ({
          playerId: player.id, name: player.name, answer: player.draft, correct: normalizeAnswer(player.draft) === normalizeAnswer(word.word),
          automatic: player.automatic, lockedAt: player.lockedAt ?? room.round!.answerLocksAt,
        })), word.word),
      } : {}),
    } : null,
    recentClues: room.recentClues.slice(-4).map((clue) => clueForRole(clue, role)!),
    player: currentPlayer ? { draft: currentPlayer.draft, draftRevision: currentPlayer.draftRevision, locked: currentPlayer.locked, lockedAutomatically: currentPlayer.automatic } : null,
  };
}

function startRound(room: PartyRoomState, now = Date.now()) {
  const number = (room.round?.number ?? 0) + 1;
  if (number > room.roundTotal) {
    room.phase = "finished";
    room.expiresAt = Math.min(room.expiresAt, now + FINISHED_GRACE_SECONDS * 1_000);
    changed(room);
    return;
  }
  const wordId = room.wordIds[number - 1];
  const word = room.words?.find(({ id }) => id === wordId);
  if (!word) throw new Error("Word unavailable");
  const countdownStartsAt = now + 700;
  const audioPlaysAt = countdownStartsAt + 3_000;
  const answerOpensAt = audioPlaysAt + 1_300;
  const answerLocksAt = answerOpensAt + room.answerSeconds * 1_000;
  room.players.forEach((player) => { player.draft = ""; player.draftRevision = 0; player.locked = false; player.automatic = false; player.lockedAt = null; });
  room.round = {
    roundId: token(), number, wordId, countdownStartsAt, audioPlaysAt, answerOpensAt, answerLocksAt, revealAt: answerLocksAt + 650,
    wordAudio: room.usesLocalSpeech ? null : { id: capability(), key: partyAudioAssetKey(word, "word") }, repeatUsed: false, definitionUsed: false,
    activeClue: null, clueCapabilities: [], scored: false,
  };
  room.phase = "countdown";
  changed(room);
}

export async function createPartyRoom(input: { deckId: string; customDeck?: PartyCustomDeckInput; recentWordIds?: string[]; answerSeconds: number; roundTotal: number }): Promise<PartyRoomCredentials> {
  const seen = new Set<string>();
  const customWords: PartyWord[] = (input.customDeck?.words ?? []).flatMap((word) => {
    const key = normalizeAnswer(word.word);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ ...word, sentence: word.sentence ?? `The word for this round is ${word.word}.` }];
  });
  const deck = input.customDeck && customWords.length >= 3
    ? { id: input.customDeck.id, name: input.customDeck.name.trim() || "My words", words: customWords }
    : partyDeck(input.deckId);
  if (!deck) throw new Error("Deck unavailable");
  const presenterToken = token();
  const joinToken = token();
  const expiresAt = Date.now() + ROOM_TTL_SECONDS * 1_000;
  const recent = new Set(input.recentWordIds ?? []);
  const freshWords = deck.words.filter(({ id }) => !recent.has(id));
  const previousWords = deck.words.filter(({ id }) => recent.has(id));
  for (const words of [freshWords, previousWords]) {
    for (let index = words.length - 1; index > 0; index -= 1) { const swap = randomInt(index + 1); [words[index], words[swap]] = [words[swap], words[index]]; }
  }
  const words = [...freshWords, ...previousWords];
  const room: PartyRoomState = {
    roomId: roomId(), deckId: deck.id, deckName: deck.name, answerSeconds: Math.max(8, Math.min(60, input.answerSeconds)),
    roundTotal: Math.max(1, Math.min(words.length, input.roundTotal)), wordIds: words.map(({ id }) => id), phase: "lobby", revision: 1,
    sequence: 1, presenterHash: hash(presenterToken), joinHash: hash(joinToken), expiresAt, sentenceCluesRemaining: 3,
    players: [], round: null, recentClues: [], processedActions: [], joinReceiptIds: [], words, usesLocalSpeech: Boolean(input.customDeck),
  };
  if (!getRedis() && process.env.NODE_ENV === "production") throw new Error("Party rooms require Redis");
  await saveRoom(room);
  log.info("things.spelling-party", "Room created", { deckId: deck.id, roundTotal: room.roundTotal });
  return { roomId: room.roomId, presenterToken, joinToken, expiresAt, selectedWordIds: room.wordIds.slice(0, room.roundTotal) };
}

export async function joinPartyRoom(input: { roomId: string; joinToken?: string; name: string; joinId: string }): Promise<PartyPlayerCredentials | { error: string }> {
  const result = await withRoom(input.roomId, async (room, keys) => {
    if (input.joinToken !== undefined && !safeEqual(input.joinToken, room.joinHash)) return { error: "Invite expired" } as const;
    if (room.phase !== "lobby") return { error: "This game has already started" } as const;
    const receipt = await readJoinReceipt(room.roomId, input.joinId, keys);
    if (receipt) return { receipt, snapshot: snapshot(room, "player", receipt.playerId), expiresAt: room.expiresAt };
    const name = input.name.trim().replace(/\s+/g, " ").slice(0, 24);
    if (name.length < 1) return { error: "Enter your name" } as const;
    if (room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return { error: "That name is already in the room" } as const;
    if (room.players.length >= 12) return { error: "This room is full" } as const;
    const playerToken = token();
    const player: PlayerState = { id: token(), name, tokenHash: hash(playerToken), score: 0, draft: "", draftRevision: 0, locked: false, automatic: false, lockedAt: null, lastSeenAt: Date.now(), integrityRoundIds: [] };
    room.players.push(player);
    const nextReceipt: JoinReceipt = { playerId: player.id, playerToken, expiresAt: Math.min(room.expiresAt, Date.now() + JOIN_RECEIPT_TTL_SECONDS * 1_000) };
    await writeJoinReceipt(room, input.joinId, nextReceipt, keys);
    changed(room);
    return { receipt: nextReceipt, snapshot: snapshot(room, "player", player.id), expiresAt: room.expiresAt };
  });
  if (!result) return { error: "Room unavailable" };
  if ("receipt" in result && result.receipt) return { roomId: input.roomId, playerId: result.receipt.playerId, playerToken: result.receipt.playerToken, expiresAt: result.expiresAt, snapshot: result.snapshot };
  return { error: result.error ?? "Could not join" };
}

function authenticate(room: PartyRoomState, role: PartyRole, credential: string, playerId?: string) {
  if (role === "presenter") return safeEqual(credential, room.presenterHash);
  const player = room.players.find(({ id }) => id === playerId);
  return Boolean(player && safeEqual(credential, player.tokenHash));
}

export async function readPartySnapshot(input: { roomId: string; role: PartyRole; credential: string; playerId?: string; lastSequence: number }): Promise<PartySnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    if (!authenticate(room, input.role, input.credential, input.playerId)) return { ok: false, snapshot: null, error: "Room unavailable" };
    if (input.role === "player") {
      const player = room.players.find(({ id }) => id === input.playerId);
      if (player) player.lastSeenAt = Date.now();
    }
    advance(room);
    return { ok: true, snapshot: snapshot(room, input.role, input.playerId) };
  });
  return result ?? { ok: false, snapshot: null, error: "Room unavailable" };
}

function actionSeen(room: PartyRoomState, actionId: string) { return room.processedActions.includes(actionId); }
function rememberAction(room: PartyRoomState, actionId: string) { room.processedActions = [...room.processedActions, actionId].slice(-300); }

export async function applyPresenterAction(input: { roomId: string; presenterToken: string; action: PartyPresenterAction }): Promise<PartyActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    if (!safeEqual(input.presenterToken, room.presenterHash)) return { ok: false, accepted: false, snapshot: null, error: "Room unavailable" };
    advance(room);
    if (actionSeen(room, input.action.actionId)) return { ok: true, accepted: true, snapshot: snapshot(room, "presenter") };
    if (input.action.type === "round.start" && room.phase === "lobby" && room.players.length > 0) startRound(room);
    else if (input.action.type === "round.next" && room.phase === "reveal") startRound(room);
    else return { ok: true, accepted: false, snapshot: snapshot(room, "presenter"), error: room.players.length ? "That action is not available now" : "Waiting for at least one player" };
    rememberAction(room, input.action.actionId);
    return { ok: true, accepted: true, snapshot: snapshot(room, "presenter") };
  });
  return result ?? { ok: false, accepted: false, snapshot: null, error: "Room unavailable" };
}

export async function applyPlayerAction(input: { roomId: string; playerId: string; playerToken: string; action: PartyPlayerAction }): Promise<PartyActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = room.players.find(({ id }) => id === input.playerId);
    if (!player || !safeEqual(input.playerToken, player.tokenHash)) return { ok: false, accepted: false, snapshot: null, error: "Room unavailable" };
    player.lastSeenAt = Date.now();
    advance(room);
    if (actionSeen(room, input.action.actionId)) return { ok: true, accepted: true, snapshot: snapshot(room, "player", player.id) };
    const round = room.round;
    if (!round || input.action.roundId !== round.roundId) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "That word has ended" };
    const now = Date.now();
    if (input.action.type === "draft.update") {
      if (room.phase !== "answer" || player.locked || now >= round.answerLocksAt) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "Answers are locked" };
      if (input.action.draftRevision > player.draftRevision) { player.draft = input.action.draft.slice(0, 64); player.draftRevision = input.action.draftRevision; changed(room); }
    } else if (input.action.type === "answer.lock") {
      if (room.phase !== "answer" || now >= round.answerLocksAt) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "Answers are locked" };
      player.locked = true; player.automatic = false; player.lockedAt = now; changed(room);
      if (room.players.every(({ locked }) => locked)) lockAll(room, now);
    } else if (input.action.type === "integrity.notice") {
      if ((room.phase === "answer" || room.phase === "locked") && input.action.hiddenMs >= 1_000 && !player.integrityRoundIds.includes(round.roundId)) { player.integrityRoundIds.push(round.roundId); changed(room); }
    } else if (input.action.type === "clue.request") {
      if (room.phase !== "answer") return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "Clues are not available now" };
      const word = wordFor(room);
      if (!word) return { ok: false, accepted: false, snapshot: null, error: "Word unavailable" };
      const kind: PartyClueKind = input.action.clue;
      if (kind === "repeat" && round.repeatUsed) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "The word is already being repeated" };
      if (kind === "definition" && round.definitionUsed) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "The definition has already been played" };
      if (kind === "sentence" && room.sentenceCluesRemaining <= 0) return { ok: true, accepted: false, snapshot: snapshot(room, "player", player.id), error: "No sentence clues remain" };
      if (kind === "repeat") round.repeatUsed = true;
      if (kind === "definition") round.definitionUsed = true;
      if (kind === "sentence") room.sentenceCluesRemaining -= 1;
      const eventId = capability();
      const asset: AudioCapability | null = room.usesLocalSpeech ? null : { id: eventId, key: partyAudioAssetKey(word, kind === "repeat" ? "word" : kind) };
      if (asset) round.clueCapabilities.push(asset);
      const message = kind === "repeat" ? `${player.name} asked to hear it again.` : kind === "definition" ? `${player.name} asked for the definition.` : `${player.name} used a sentence clue · ${room.sentenceCluesRemaining} remaining.`;
      const speechText = kind === "repeat" ? word.speakAs ?? word.word : kind === "definition" ? word.definition ?? "No definition is available for this word." : word.sentence;
      const event: PartyClueEvent = { id: eventId, kind, playerName: player.name, message, createdAt: now, audioUrl: asset ? audioUrl(room.roomId, asset.id) : null, speechText };
      round.activeClue = event; room.recentClues.push(event); changed(room);
    }
    rememberAction(room, input.action.actionId);
    return { ok: true, accepted: true, snapshot: snapshot(room, "player", player.id) };
  });
  return result ?? { ok: false, accepted: false, snapshot: null, error: "Room unavailable" };
}

export async function authorizePartySocket(input: { roomId: string; role: PartyRole; credential: string; playerId?: string }) {
  const loaded = await loadRoom(input.roomId);
  return Boolean(loaded && authenticate(loaded.room, input.role, input.credential, input.playerId));
}

export async function getPartyAudioAsset(roomIdValue: string, assetId: string) {
  const loaded = await loadRoom(roomIdValue);
  const round = loaded?.room.round;
  if (!round || assetId.length > 80) return null;
  if (round.wordAudio?.id === assetId) return round.wordAudio.key;
  return round.clueCapabilities.find(({ id }) => id === assetId)?.key ?? null;
}

export async function closePartyRoom(roomIdValue: string, presenterToken: string) {
  const loaded = await loadRoom(roomIdValue);
  if (!loaded) return { ok: true };
  if (!safeEqual(presenterToken, loaded.room.presenterHash)) return { ok: false };
  await deletePartyRoom(loaded.room, loaded.keys);
  log.info("things.spelling-party", "Room closed", { phase: loaded.room.phase });
  return { ok: true };
}
