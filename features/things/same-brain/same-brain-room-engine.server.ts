import { randomInt } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { sameBrainRoomRedisKeys } from "./same-brain-keys";
import {
  createMemoryRoomStore,
  createAvailableMultiplayerRoomId,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerActionSeen,
  multiplayerCredentialsMatch,
  multiplayerRoomStateChanged,
  multiplayerSnapshotDigest,
  registerMemoryRoomSweeper,
  rememberMultiplayerAction,
  remainingMultiplayerRoomTtlSeconds,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import {
  MULTIPLAYER_PRESENCE_TOUCH_INTERVAL_MS,
  touchMultiplayerPresence,
} from "../shared/room-presence";
import type { MultiplayerLockAttempt } from "../shared/room-primitives.server";
import {
  multiplayerFailure,
  multiplayerLobbyExpiresAt,
  multiplayerPresenceLeaseExpiresAt,
  multiplayerRoomExpiry,
  type MultiplayerRoomPhaseKind,
} from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import {
  publishOfficialResultsAfterCommit,
  persistRoomWithOfficialResults,
  sealOfficialGameResult,
} from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import { sameBrainQuestion } from "./same-brain-questions";
import {
  SAME_BRAIN_CONNECTED_WINDOW_MS,
  SAME_BRAIN_DEFAULT_ROUNDS,
  SAME_BRAIN_DEFAULT_TOGGLES,
  SAME_BRAIN_HOST_CLAIM_AFTER_MS,
  SAME_BRAIN_MAX_ANSWER_LENGTH,
  SAME_BRAIN_MAX_NAME_LENGTH,
  SAME_BRAIN_PLAYER_LIMITS,
  SAME_BRAIN_ROUND_LIMITS,
  SAME_BRAIN_TIMING_BOUNDS,
  answerIsUsable,
  normaliseAnswer,
  oddPlayerOf,
  sameBrainTimings,
  scoreClusters,
  scoreRound,
  winnersOf,
} from "./same-brain-rules";
import type {
  SameBrainActionResult,
  SameBrainAnswer,
  SameBrainHostAction,
  SameBrainJoinResult,
  SameBrainPhase,
  SameBrainPlayerAction,
  SameBrainPlayerSummary,
  SameBrainRejectionCode,
  SameBrainRoomCredentials,
  SameBrainRoomErrorCode,
  SameBrainRoundResult,
  SameBrainSnapshot,
  SameBrainSnapshotResult,
  SameBrainTimings,
  SameBrainToggles,
} from "./types";

/**
 * The room. Same layering as liars — load, lock, mutate, save — because that shape is already proven
 * against reconnects, duplicate actions and a host whose phone died.
 *
 * Scoring is synchronous and deterministic. Closing a submit phase immediately creates the reveal,
 * so there is no hidden work or second state transition for another phone to trigger.
 */

const FINISHED_GRACE_SECONDS = 20 * 60;
const JOIN_RECEIPT_TTL_SECONDS = 2 * 60;

interface PlayerState {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
  lastSeenAt: number;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;
  score: number;
  out: boolean;
  aloneCount: number;
  /** This round's answer, exactly as typed. Never leaves the server until the reveal. */
  answer: string | null;
  /** Set when the player leaves or is removed after play starts; retained for result history. */
  leftAt?: number;
}

interface SameBrainRoomState {
  roomId: string;
  /** The game-night pool owns admission and lobby settings for this room. */
  managed?: boolean;
  officialResultChannelId?: string;
  phase: SameBrainPhase;
  revision: number;
  sequence: number;
  hostHash: string;
  joinHash: string;
  expiresAt: number;
  gameNumber: number;
  round: number;
  rounds: number;
  toggles: SameBrainToggles;
  timings: SameBrainTimings;
  phaseStartedAt: number;
  phaseEndsAt: number;
  pausedAt: number | null;
  lastActiveAt: number;
  players: PlayerState[];
  hostPlayerId: string | null;
  hostDisconnectedSince: number | null;
  question: string | null;
  recentQuestions: string[];
  result: SameBrainRoundResult | null;
  /** What the room produced before any host correction, so "put it back" is exact. */
  resultBaseline: SameBrainRoundResult | null;
  history: SameBrainRoundResult[];
  processedActions: string[];
  joinReceiptIds: string[];
  winnerIds: string[];
}

interface JoinReceipt {
  playerId: string;
  playerToken: string;
  expiresAt: number;
}

const memoryRooms = createMemoryRoomStore<SameBrainRoomState>("same-brain");
const memoryJoinReceipts = createMemoryRoomStore<JoinReceipt>("same-brain-receipts");

registerMemoryRoomSweeper("same-brain", (now) => {
  for (const [roomId, room] of memoryRooms) {
    if (room.expiresAt > now) continue;
    memoryRooms.delete(roomId);
    for (const joinId of room.joinReceiptIds)
      memoryJoinReceipts.delete(memoryReceiptKey(roomId, joinId));
  }
  for (const [key, receipt] of memoryJoinReceipts)
    if (receipt.expiresAt <= now) memoryJoinReceipts.delete(key);
});
let lockObserver: ((input: MultiplayerLockAttempt) => void) | null = null;

export function setSameBrainRoomLockObserver(observer: typeof lockObserver) {
  lockObserver = observer;
}

type SameBrainRedisKeys = ReturnType<typeof sameBrainRoomRedisKeys>;
const token = createMultiplayerCredential;
const hash = hashMultiplayerCredential;
const safeEqual = multiplayerCredentialsMatch;

function phaseKind(room: SameBrainRoomState): MultiplayerRoomPhaseKind {
  if (room.phase === "lobby") return "lobby";
  if (room.phase === "ending") return "results";
  return "active";
}

function applyRoomExpiry(room: SameBrainRoomState, now = Date.now()) {
  room.expiresAt = multiplayerRoomExpiry({
    kind: phaseKind(room),
    // Eliminated players keep watching the reveal, so anyone who has not explicitly left
    // keeps the room alive.
    presentCount: presentPlayerCount(room),
    expiresAt: room.expiresAt,
    now,
  });
}

function changed(room: SameBrainRoomState) {
  room.revision += 1;
  room.sequence += 1;
  applyRoomExpiry(room);
}

function presentPlayerCount(room: SameBrainRoomState) {
  return room.players.filter(({ leftAt }) => leftAt === undefined).length;
}

function failure(errorCode: SameBrainRejectionCode, error: string): SameBrainActionResult {
  return { accepted: false, errorCode, error, snapshot: null };
}

function reject(
  snapshot: SameBrainSnapshot,
  errorCode: SameBrainRejectionCode,
  error: string,
): SameBrainActionResult {
  return { accepted: false, errorCode, error, snapshot };
}

function accept(snapshot: SameBrainSnapshot): SameBrainActionResult {
  return { accepted: true, snapshot };
}

function memoryReceiptKey(roomId: string, joinId: string) {
  return `${roomId}:${joinId}`;
}

async function deleteRoom(room: SameBrainRoomState, keys: SameBrainRedisKeys) {
  const redis = getRedis();
  if (redis) {
    await redis.del(
      keys.state,
      keys.lock,
      ...room.joinReceiptIds.map((joinId) => keys.joinReceipt(joinId)),
    );
  } else {
    memoryRooms.delete(room.roomId);
    for (const joinId of room.joinReceiptIds)
      memoryJoinReceipts.delete(memoryReceiptKey(room.roomId, joinId));
  }
}

async function loadRoom(
  id: string,
): Promise<{ room: SameBrainRoomState; keys: SameBrainRedisKeys } | null> {
  const keys = sameBrainRoomRedisKeys(id);
  const redis = getRedis();
  const room = redis
    ? await redis.get<SameBrainRoomState>(keys.state)
    : (memoryRooms.get(id) ?? null);
  if (!room) return null;
  if (room.expiresAt <= Date.now()) {
    await deleteRoom(room, keys);
    return null;
  }
  return { room, keys };
}

async function saveRoom(
  room: SameBrainRoomState,
  keys = sameBrainRoomRedisKeys(room.roomId),
  envelopes: OfficialGameResultEnvelope[] = [],
) {
  const redis = getRedis();
  // Presence touches reach here without a revision bump, so the lease renews on save.
  applyRoomExpiry(room);
  if (room.expiresAt <= Date.now()) {
    await deleteRoom(room, keys);
    return [];
  }
  if (redis) {
    return persistRoomWithOfficialResults({
      redis,
      stateKey: keys.state,
      room,
      ttlSeconds: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
      envelopes,
    });
  }
  memoryRooms.set(room.roomId, room);
  return envelopes.map((envelope) => ({ key: `memory:${envelope.payloadHash}`, envelope }));
}

async function withRoom<T>(
  id: string,
  use: (room: SameBrainRoomState, keys: SameBrainRedisKeys) => T | Promise<T>,
): Promise<T | null> {
  const redis = getRedis();
  if (!redis) {
    const loaded = await loadRoom(id);
    if (!loaded) return null;
    const before = JSON.stringify(loaded.room);
    const wasEnding = loaded.room.phase === "ending";
    const result = await use(loaded.room, loaded.keys);
    const envelope =
      !wasEnding && loaded.room.phase === "ending" ? sameBrainOfficialResult(loaded.room) : null;
    const queued = multiplayerRoomStateChanged(before, loaded.room)
      ? await saveRoom(loaded.room, loaded.keys, envelope ? [envelope] : [])
      : [];
    publishOfficialResultsAfterCommit(queued);
    return result;
  }
  const initial = await loadRoom(id);
  if (!initial) return null;
  let queued: Array<{ key: string; envelope: OfficialGameResultEnvelope }> = [];
  const result = await withMultiplayerRoomLock(
    redis,
    { roomId: id, lockKey: initial.keys.lock, onAttempt: (attempt) => lockObserver?.(attempt) },
    async () => {
      const room = await redis.get<SameBrainRoomState>(initial.keys.state);
      if (!room || room.expiresAt <= Date.now()) return null;
      const before = JSON.stringify(room);
      const wasEnding = room.phase === "ending";
      const result = await use(room, initial.keys);
      if (multiplayerRoomStateChanged(before, room)) {
        const envelope =
          !wasEnding && room.phase === "ending" ? sameBrainOfficialResult(room) : null;
        queued = await saveRoom(room, initial.keys, envelope ? [envelope] : []);
      }
      return result;
    },
  );
  publishOfficialResultsAfterCommit(queued);
  return result;
}

function sameBrainOfficialResult(room: SameBrainRoomState): OfficialGameResultEnvelope | null {
  if (!room.officialResultChannelId || room.phase !== "ending") return null;
  const ranked = room.players.toSorted(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
  let priorScore: number | null = null;
  let priorPlacement = 0;
  return sealOfficialGameResult({
    channelId: room.officialResultChannelId,
    revision: 1,
    result: {
      gameKind: "same-brain",
      gameInstanceId: room.roomId,
      resultId: `game:${room.gameNumber}`,
      scope: "game",
      players: ranked.map((player, index) => {
        const placement = player.score === priorScore ? priorPlacement : index + 1;
        priorScore = player.score;
        priorPlacement = placement;
        return {
          playerId: player.id,
          outcome: player.leftAt === undefined ? "completed" : "withdrawn",
          rawScore: player.score,
          placement,
          won: room.winnerIds.includes(player.id),
        };
      }),
    },
  });
}

async function readJoinReceipt(roomId: string, joinId: string, keys: SameBrainRedisKeys) {
  const redis = getRedis();
  const receipt = redis
    ? await redis.get<JoinReceipt>(keys.joinReceipt(joinId))
    : (memoryJoinReceipts.get(memoryReceiptKey(roomId, joinId)) ?? null);
  if (!receipt || receipt.expiresAt <= Date.now()) {
    if (redis) await redis.del(keys.joinReceipt(joinId));
    else memoryJoinReceipts.delete(memoryReceiptKey(roomId, joinId));
    return null;
  }
  return receipt;
}

async function writeJoinReceipt(
  room: SameBrainRoomState,
  joinId: string,
  receipt: JoinReceipt,
  keys: SameBrainRedisKeys,
) {
  if (!room.joinReceiptIds.includes(joinId)) room.joinReceiptIds.push(joinId);
  const redis = getRedis();
  if (redis)
    await redis.set(keys.joinReceipt(joinId), receipt, {
      ex: remainingMultiplayerRoomTtlSeconds(receipt.expiresAt),
    });
  else memoryJoinReceipts.set(memoryReceiptKey(room.roomId, joinId), receipt);
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

const playing = (room: SameBrainRoomState) => room.players.filter(({ out }) => !out);
const connected = (player: PlayerState, now: number) =>
  now - player.lastSeenAt <= SAME_BRAIN_CONNECTED_WINDOW_MS;

function transferHost(room: SameBrainRoomState, leavingId: string, now: number) {
  const eligible = room.players
    .filter(({ id, out, leftAt }) => id !== leavingId && !out && leftAt === undefined)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const next = eligible.find((candidate) => connected(candidate, now)) ?? eligible[0] ?? null;
  room.hostPlayerId = next?.id ?? null;
  room.hostDisconnectedSince = next && !connected(next, now) ? now : null;
}

function phaseDuration(room: SameBrainRoomState, phase: SameBrainPhase) {
  switch (phase) {
    case "prompt":
      return room.timings.prompt;
    case "submit":
      return room.timings.submit;
    case "sayIt":
      return room.timings.sayIt;
    case "reveal":
      return room.timings.reveal;
    default:
      return 0;
  }
}

function enterPhase(room: SameBrainRoomState, phase: SameBrainPhase, now: number) {
  room.phase = phase;
  room.phaseStartedAt = now;
  const duration = phaseDuration(room, phase);
  room.phaseEndsAt = duration > 0 ? now + duration : 0;
  changed(room);
}

function startRound(room: SameBrainRoomState, now: number) {
  room.round += 1;
  room.result = null;
  room.resultBaseline = null;
  for (const player of room.players) player.answer = null;
  room.question = sameBrainQuestion(room.recentQuestions, (max) => randomInt(max));
  // Long enough that a group playing all evening does not see a repeat, short enough that the state
  // blob stays small.
  room.recentQuestions = [...room.recentQuestions, room.question].slice(-40);
  enterPhase(room, "prompt", now);
}

function finish(room: SameBrainRoomState, now: number) {
  room.winnerIds = winnersOf(room.players);
  room.question = null;
  enterPhase(room, "ending", now);
  room.expiresAt = Math.min(room.expiresAt, now + FINISHED_GRACE_SECONDS * 1_000);
}

/**
 * A game can also end because the house rule emptied it. Two players is the floor for a herd to mean
 * anything, so the game stops there rather than limping on with a winner by attrition.
 */
function gameOver(room: SameBrainRoomState) {
  if (room.round >= room.rounds) return true;
  return room.toggles.eliminateOddOne && playing(room).length < 2;
}

function afterReveal(room: SameBrainRoomState, now: number) {
  if (gameOver(room)) {
    finish(room, now);
    return;
  }
  startRound(room, now);
}

/**
 * Moves the room on when its clock says so. Synchronous and side-effect free beyond the room itself,
 * so tests can drive a whole game with fake timers.
 */
function advance(room: SameBrainRoomState, now = Date.now()) {
  if (room.pausedAt !== null) return;

  for (let guard = 0; guard < 8; guard += 1) {
    if (room.phaseEndsAt === 0 || now < room.phaseEndsAt) return;
    switch (room.phase) {
      case "prompt":
        enterPhase(room, "submit", now);
        break;
      case "submit":
        closeSubmit(room, now);
        return;
      case "sayIt":
        enterPhase(room, "reveal", now);
        break;
      case "reveal":
        afterReveal(room, now);
        break;
      default:
        return;
    }
  }
}

/** Everyone still in the game has answered, so there is nothing left to wait for. */
function everyoneAnswered(room: SameBrainRoomState) {
  const active = playing(room);
  return active.length > 0 && active.every(({ answer }) => answer !== null);
}

function computeResult(room: SameBrainRoomState): SameBrainRoundResult {
  const answers: SameBrainAnswer[] = playing(room)
    .filter((player) => player.answer !== null && answerIsUsable(player.answer))
    .map((player) => ({
      playerId: player.id,
      text: player.answer as string,
      normalised: normaliseAnswer(player.answer as string),
    }));

  return scoreRound({
    round: room.round,
    question: room.question ?? "",
    answers,
    // Everyone still in the game, not everyone who answered — see `scoreClusters`.
    playerCount: playing(room).length,
  });
}

function closeSubmit(room: SameBrainRoomState, now: number) {
  room.phaseEndsAt = now;
  applyResult(room, computeResult(room), now);
}

/**
 * The consequences of a result, applied or reversed.
 *
 * Split from `applyResult` so a host correction can put the round back the way it was and score it
 * again from scratch, rather than trying to compute a difference. Reversing is exact — the same
 * arithmetic with the sign flipped — which is what makes a correction safe to make twice.
 */
function awardResult(room: SameBrainRoomState, result: SameBrainRoundResult, sign: 1 | -1) {
  if (result.herdIndex !== null) {
    for (const playerId of result.clusters[result.herdIndex].playerIds) {
      const player = room.players.find(({ id }) => id === playerId);
      if (player) player.score += sign * result.pointsEach;
    }
  }

  if (result.oddPlayerId) {
    const odd = room.players.find(({ id }) => id === result.oddPlayerId);
    if (odd) {
      odd.aloneCount = Math.max(0, odd.aloneCount + sign);
      // Only this round's elimination is undone: a player out from an earlier round stays out,
      // because `out` is never set twice for the same person.
      if (room.toggles.eliminateOddOne) odd.out = sign === 1;
    }
  }
}

function applyResult(room: SameBrainRoomState, result: SameBrainRoundResult, now: number) {
  room.result = result;
  room.resultBaseline = result;
  room.history.push(result);
  awardResult(room, result, 1);

  /**
   * Scored, but not shown yet.
   *
   * The round is decided the moment answers lock — saying them out loud cannot change it, which is
   * exactly why the beat is safe to put here. `snapshot` withholds `result` until the reveal, so
   * during `sayIt` the only word on any screen is the reader's own and the room genuinely hears them
   * all at once. A group with the toggle off goes straight to the reveal as before.
   */
  if (room.toggles.sayItAloud && result.answers.length > 0) {
    enterPhase(room, "sayIt", now);
    return;
  }

  enterPhase(room, "reveal", now);
}

/** Runs the room clock before a read or action. The first phone to touch an expired room advances it. */
async function pump(roomId: string) {
  await withRoom(roomId, (room) => advance(room, Date.now()));
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function summaryOf(
  room: SameBrainRoomState,
  player: PlayerState,
  now: number,
): SameBrainPlayerSummary {
  return {
    id: player.id,
    name: player.name,
    connected: connected(player, now),
    ready: multiplayerPlayerReady(player),
    host: room.hostPlayerId === player.id,
    ...(player.leftAt === undefined ? {} : { left: true }),
    score: player.score,
    out: player.out,
    aloneCount: player.aloneCount,
    answered: player.answer !== null,
  };
}

function snapshot(
  room: SameBrainRoomState,
  viewerId?: string,
  now = Date.now(),
): SameBrainSnapshot {
  const viewer = room.players.find(({ id }) => id === viewerId);
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  return {
    roomId: room.roomId,
    managed: room.managed === true,
    phase: room.phase,
    revision: room.revision,
    sequence: room.sequence,
    serverNow: now,
    expiresAt: room.expiresAt,
    round: room.round,
    rounds: room.rounds,
    toggles: room.toggles,
    timings: room.timings,
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    paused: room.pausedAt !== null,
    players: room.players.map((player) => summaryOf(room, player, now)),
    hostPlayerId: room.hostPlayerId,
    hostDisconnected: Boolean(host && !connected(host, now)),
    you: viewer
      ? {
          id: viewer.id,
          answer: viewer.answer,
          out: viewer.out,
          startRequestId: viewer.startRequestId ?? null,
        }
      : null,
    // The question is public — the secrecy in this game is only ever about other people's answers,
    // and those stay server-side until the reveal builds a result.
    question: room.phase === "lobby" ? null : room.question,
    result: room.phase === "reveal" || room.phase === "ending" ? room.result : null,
    history: room.phase === "ending" ? room.history : [],
    winnerIds: room.winnerIds,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createSameBrainRoom(input: {
  rounds?: number;
  toggles?: Partial<SameBrainToggles>;
  timings?: Partial<SameBrainTimings>;
  managed?: boolean;
  officialResultChannelId?: string;
}): Promise<SameBrainRoomCredentials> {
  const hostToken = token();
  const joinToken = token();
  const now = Date.now();
  const expiresAt = multiplayerLobbyExpiresAt(now, 1);
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const room: SameBrainRoomState = {
    roomId,
    managed: input.managed,
    officialResultChannelId: input.officialResultChannelId,
    phase: "lobby",
    revision: 1,
    sequence: 1,
    hostHash: hash(hostToken),
    joinHash: hash(joinToken),
    expiresAt,
    gameNumber: 1,
    round: 0,
    rounds: clampRounds(input.rounds ?? SAME_BRAIN_DEFAULT_ROUNDS),
    toggles: { ...SAME_BRAIN_DEFAULT_TOGGLES, ...input.toggles },
    timings: sameBrainTimings(input.timings),
    phaseStartedAt: now,
    phaseEndsAt: 0,
    pausedAt: null,
    lastActiveAt: now,
    players: [],
    hostPlayerId: null,
    hostDisconnectedSince: null,
    question: null,
    recentQuestions: [],
    result: null,
    resultBaseline: null,
    history: [],
    processedActions: [],
    joinReceiptIds: [],
    winnerIds: [],
  };
  if (!getRedis() && process.env.NODE_ENV === "production")
    throw new Error("Same brain rooms require Redis");
  await saveRoom(room);
  log.info("things.same-brain", "Room created", { rounds: room.rounds });
  return { roomId, hostToken, joinToken, expiresAt };
}

function clampRounds(value: number) {
  return Math.max(
    SAME_BRAIN_ROUND_LIMITS.min,
    Math.min(SAME_BRAIN_ROUND_LIMITS.max, Math.floor(value)),
  );
}

export async function joinSameBrainRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
  joinId: string;
  hostToken?: string;
}): Promise<SameBrainJoinResult> {
  const result = await withRoom(input.roomId, async (room, keys) => {
    if (
      (room.managed && input.joinToken === undefined) ||
      (input.joinToken !== undefined && !safeEqual(input.joinToken, room.joinHash))
    )
      return { errorCode: "invite_expired" as const, error: "Invite expired" };
    if (room.phase !== "lobby")
      return { errorCode: "game_started" as const, error: "This game has already started" };

    const receipt = await readJoinReceipt(room.roomId, input.joinId, keys);
    if (receipt)
      return {
        receipt,
        snapshot: snapshot(room, receipt.playerId),
        expiresAt: room.expiresAt,
      };

    const name = input.name.trim().replace(/\s+/g, " ");
    if (name.length < 1) return { errorCode: "invalid_name" as const, error: "Enter your name" };
    if (name.length > SAME_BRAIN_MAX_NAME_LENGTH)
      return {
        errorCode: "invalid_name" as const,
        error: `Use ${SAME_BRAIN_MAX_NAME_LENGTH} characters or fewer`,
      };
    if (room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      return { errorCode: "name_taken" as const, error: "That name is already in the room" };
    if (room.players.length >= SAME_BRAIN_PLAYER_LIMITS.max)
      return { errorCode: "room_full" as const, error: "This room is full" };

    const playerToken = token();
    const now = Date.now();
    const player: PlayerState = {
      id: token(),
      name,
      tokenHash: hash(playerToken),
      joinedAt: now,
      lastSeenAt: now,
      ready: true,
      startRequestId: null,
      startRequestedAt: null,
      score: 0,
      out: false,
      aloneCount: 0,
      answer: null,
    };
    room.players.push(player);
    if (input.hostToken && safeEqual(input.hostToken, room.hostHash)) room.hostPlayerId = player.id;
    room.hostPlayerId ??= player.id;

    const nextReceipt: JoinReceipt = {
      playerId: player.id,
      playerToken,
      expiresAt: Math.min(room.expiresAt, now + JOIN_RECEIPT_TTL_SECONDS * 1_000),
    };
    await writeJoinReceipt(room, input.joinId, nextReceipt, keys);
    changed(room);
    return { receipt: nextReceipt, snapshot: snapshot(room, player.id), expiresAt: room.expiresAt };
  });

  if (!result) return multiplayerFailure("room_unavailable", "Room unavailable");
  if ("receipt" in result && result.receipt)
    return {
      ok: true,
      roomId: input.roomId,
      playerId: result.receipt.playerId,
      playerToken: result.receipt.playerToken,
      expiresAt: result.expiresAt,
      snapshot: result.snapshot,
    };
  return multiplayerFailure(
    (result as { errorCode: SameBrainRoomErrorCode }).errorCode,
    (result as { error?: string }).error ?? "Could not join",
  );
}

function authenticate(room: SameBrainRoomState, credential: string, playerId?: string) {
  const player = room.players.find(({ id }) => id === playerId);
  if (player) return player.leftAt === undefined && safeEqual(credential, player.tokenHash);
  return safeEqual(credential, room.hostHash);
}

function touch(room: SameBrainRoomState, playerId: string | undefined, now: number, force = false) {
  const player = room.players.find(({ id }) => id === playerId);
  if (player) touchMultiplayerPresence(player, now, force);
  if (force || !player || now - room.lastActiveAt >= MULTIPLAYER_PRESENCE_TOUCH_INTERVAL_MS)
    room.lastActiveAt = now;
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  room.hostDisconnectedSince =
    host && !connected(host, now) ? (room.hostDisconnectedSince ?? now) : null;
}

export async function readSameBrainSnapshot(input: {
  roomId: string;
  credential: string;
  playerId?: string;
  lastSequence: number;
  /** What this viewer already holds. Matching it means the body can be left off entirely. */
  lastDigest?: string | null;
}): Promise<SameBrainSnapshotResult> {
  // A poll is what closes a timed-out submit, so the clock runs before the snapshot is taken.
  await pump(input.roomId);
  const result = await withRoom(input.roomId, (room) => {
    if (!authenticate(room, input.credential, input.playerId))
      return { ...multiplayerFailure("room_unavailable", "Room unavailable"), snapshot: null };
    const now = Date.now();
    touch(room, input.playerId, now);
    // Hashed after redaction: two players in one room hold different views and must not be able
    // to share a digest.
    const view = snapshot(room, input.playerId, now);
    view.digest = multiplayerSnapshotDigest(view);
    if (input.lastDigest && input.lastDigest === view.digest)
      return { ok: true as const, unchanged: true as const, serverNow: now, snapshot: null };
    return { ok: true as const, snapshot: view };
  });
  return (
    result ?? { ...multiplayerFailure("room_unavailable", "Room unavailable"), snapshot: null }
  );
}

export async function applySameBrainHostAction(input: {
  roomId: string;
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
  action: SameBrainHostAction;
}): Promise<SameBrainActionResult> {
  await pump(input.roomId);
  const result = await withRoom(input.roomId, (room) => {
    const asHostToken = input.hostToken && safeEqual(input.hostToken, room.hostHash);
    const player = room.players.find(({ id }) => id === input.playerId);
    const asHostPlayer =
      player &&
      input.playerToken &&
      safeEqual(input.playerToken, player.tokenHash) &&
      room.hostPlayerId === player.id;
    if (!asHostToken && !asHostPlayer) return failure("room_unavailable", "Room unavailable");

    const now = Date.now();
    touch(room, input.playerId, now, true);
    advance(room, now);
    const view = () => snapshot(room, input.playerId, now);
    if (multiplayerActionSeen(room.processedActions, input.action.actionId)) return accept(view());

    const action = input.action;
    const remembered = () => {
      room.processedActions = rememberMultiplayerAction(room.processedActions, action.actionId);
      return accept(snapshot(room, input.playerId, now));
    };

    if (action.type === "game.configure") {
      if (room.managed)
        return reject(view(), "action_unavailable", "The game-night settings are fixed");
      if (room.phase !== "lobby")
        return reject(view(), "action_unavailable", "House rules are set before the game starts");
      if (action.rounds !== undefined) room.rounds = clampRounds(action.rounds);
      if (action.toggles) room.toggles = { ...room.toggles, ...action.toggles };
      if (action.timings) room.timings = sameBrainTimings({ ...room.timings, ...action.timings });
      changed(room);
      return remembered();
    }

    if (action.type === "game.start") {
      if (room.phase !== "lobby") return reject(view(), "action_unavailable", "Already playing");
      if (room.players.length < SAME_BRAIN_PLAYER_LIMITS.min)
        return reject(
          view(),
          "not_enough_players",
          `${SAME_BRAIN_PLAYER_LIMITS.min} people is the smallest game`,
        );
      // A player who has not confirmed gets buzzed. The second request names exactly who the host
      // saw as absent, and the same locked mutation rechecks that list before removing anyone.
      const confirmed = new Set(action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(room.players);
      const unconfirmed = unready.filter(
        ({ id, startRequestId }) =>
          id === room.hostPlayerId || !confirmed.has(id) || !startRequestId,
      );
      if (unconfirmed.length > 0) {
        if (requestMultiplayerReadiness(unconfirmed, action.actionId, now)) changed(room);
        const names = unconfirmed.map(({ name }) => name).join(", ");
        return reject(
          view(),
          "players_not_ready",
          unconfirmed.length === 1 ? `${names} is not ready` : `${names} are not ready`,
        );
      }
      const remainingPlayers = room.players.filter(
        (candidate) => multiplayerPlayerReady(candidate) || !confirmed.has(candidate.id),
      );
      if (remainingPlayers.length < SAME_BRAIN_PLAYER_LIMITS.min)
        return reject(
          view(),
          "not_enough_players",
          `${SAME_BRAIN_PLAYER_LIMITS.min} ready people are needed to start`,
        );
      if (remainingPlayers.length !== room.players.length) {
        room.players = remainingPlayers;
        changed(room);
      }
      room.round = 0;
      room.history = [];
      room.winnerIds = [];
      for (const player of room.players) {
        player.score = 0;
        player.out = false;
        player.aloneCount = 0;
        player.answer = null;
      }
      startRound(room, now);
      return remembered();
    }

    if (action.type === "game.skipQuestion") {
      if (room.phase !== "prompt" && room.phase !== "submit")
        return reject(view(), "action_unavailable", "There is no question to change");
      // Does not consume a round: a question nobody understood should cost nothing.
      room.round -= 1;
      startRound(room, now);
      return remembered();
    }

    if (action.type === "phase.extend") {
      if (room.phaseEndsAt === 0)
        return reject(view(), "action_unavailable", "Nothing is running down");
      room.phaseEndsAt += 20_000;
      changed(room);
      return remembered();
    }

    /**
     * Somebody has to explain the rules, or answer the door.
     *
     * `phaseEndsAt` is an absolute moment, so resuming has to push it forward by however long the
     * room was paused. Without that the timer keeps running while frozen and the phase expires the
     * instant play resumes — which is worse than not having a pause button, because the host would
     * be the one who broke the round.
     */
    if (action.type === "phase.pause") {
      if (room.pausedAt !== null) return reject(view(), "action_unavailable", "Already paused");
      if (room.phase === "lobby" || room.phase === "ending")
        return reject(view(), "action_unavailable", "Nothing to pause");
      /**
       * Not the spoken beat. Its countdown is drawn from `phaseEndsAt` on each phone independently,
       * which is what keeps six of them in step; freezing the server's clock underneath that would
       * leave the phones counting to a moment that has moved. It lasts seven seconds — if it goes
       * wrong, letting it finish costs less than desynchronising it.
       */
      if (room.phase === "sayIt")
        return reject(view(), "action_unavailable", "Let them say it first");
      room.pausedAt = now;
      changed(room);
      return remembered();
    }

    if (action.type === "phase.resume") {
      if (room.pausedAt === null) return reject(view(), "action_unavailable", "Not paused");
      const frozenFor = Math.max(0, now - room.pausedAt);
      if (room.phaseEndsAt !== 0) room.phaseEndsAt += frozenFor;
      room.pausedAt = null;
      changed(room);
      return remembered();
    }

    if (action.type === "phase.advance") {
      if (room.phase === "submit") {
        closeSubmit(room, now);
        return remembered();
      }
      if (room.phase === "prompt") {
        enterPhase(room, "submit", now);
        return remembered();
      }
      if (room.phase === "sayIt") {
        enterPhase(room, "reveal", now);
        return remembered();
      }
      if (room.phase === "reveal") {
        afterReveal(room, now);
        return remembered();
      }
      return reject(view(), "action_unavailable", "Nothing to skip");
    }

    /** The host can correct an exact grouping when the room agrees two answers meant the same thing. */
    if (action.type === "result.merge" || action.type === "result.reset") {
      if (room.phase !== "reveal" || !room.result)
        return reject(view(), "action_unavailable", "There is no result to change");
      if (action.round !== room.round)
        return reject(view(), "phase_ended", "That round has closed");

      if (action.type === "result.reset") {
        if (!room.resultBaseline || room.result === room.resultBaseline)
          return reject(view(), "action_unavailable", "Nothing has been changed");
        awardResult(room, room.result, -1);
        room.result = room.resultBaseline;
        awardResult(room, room.result, 1);
        room.history[room.history.length - 1] = room.result;
        changed(room);
        return remembered();
      }

      const clusters = room.result.clusters;
      if (
        action.from === action.to ||
        !clusters[action.from] ||
        !clusters[action.to] ||
        action.from < 0 ||
        action.to < 0
      )
        return reject(view(), "action_unavailable", "Those are not two groups");

      awardResult(room, room.result, -1);
      const merged = clusters.map((cluster, index) =>
        index === action.to
          ? {
              ...cluster,
              playerIds: [...cluster.playerIds, ...clusters[action.from].playerIds],
              spellings: [...cluster.spellings, ...clusters[action.from].spellings],
            }
          : { ...cluster, playerIds: [...cluster.playerIds], spellings: [...cluster.spellings] },
      );
      merged.splice(action.from, 1);

      const { herdIndex, pointsEach, noScoreReason } = scoreClusters(merged, playing(room).length);
      room.result = {
        ...room.result,
        clusters: merged,
        herdIndex,
        pointsEach,
        noScoreReason,
        oddPlayerId: oddPlayerOf(merged, herdIndex),
        corrected: true,
      };
      awardResult(room, room.result, 1);
      room.history[room.history.length - 1] = room.result;
      changed(room);
      return remembered();
    }

    if (action.type === "host.pass") {
      const target = room.players.find(({ id, leftAt }) => id === action.playerId && !leftAt);
      if (!target) return reject(view(), "action_unavailable", "They are not here");
      room.hostPlayerId = target.id;
      changed(room);
      return remembered();
    }

    if (action.type === "player.remove") {
      const target = room.players.find(({ id }) => id === action.playerId);
      if (!target) return reject(view(), "action_unavailable", "They are not here");
      if (room.phase === "lobby") {
        room.players = room.players.filter(({ id }) => id !== action.playerId);
        if (room.hostPlayerId === action.playerId) transferHost(room, action.playerId, now);
      } else {
        target.out = true;
        target.answer = null;
        target.leftAt = now;
        target.tokenHash = hash(token());
        if (room.hostPlayerId === action.playerId) transferHost(room, action.playerId, now);
      }
      changed(room);
      return remembered();
    }

    if (action.type === "game.replay" || action.type === "game.lobby") {
      room.players = room.players.filter(({ leftAt }) => leftAt === undefined);
      room.gameNumber += 1;
      room.round = 0;
      room.result = null;
      room.resultBaseline = null;
      room.history = [];
      room.winnerIds = [];
      room.question = null;
      for (const player of room.players) {
        player.score = 0;
        player.out = false;
        player.aloneCount = 0;
        player.answer = null;
        setMultiplayerPlayerReady(player, true);
      }
      if (action.type === "game.replay") startRound(room, now);
      else enterPhase(room, "lobby", now);
      return remembered();
    }

    if (action.type === "game.end") {
      finish(room, now);
      return remembered();
    }

    return reject(view(), "action_unavailable", "Unknown action");
  });

  return result ?? failure("room_unavailable", "Room unavailable");
}

export async function applySameBrainPlayerAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action: SameBrainPlayerAction;
}): Promise<SameBrainActionResult> {
  await pump(input.roomId);
  const result = await withRoom(input.roomId, (room) => {
    const player = room.players.find(({ id }) => id === input.playerId);
    if (!player || !safeEqual(input.playerToken, player.tokenHash))
      return failure("room_unavailable", "Room unavailable");
    const now = Date.now();
    touch(room, player.id, now, true);
    advance(room, now);
    const view = () => snapshot(room, player.id, now);
    if (multiplayerActionSeen(room.processedActions, input.action.actionId)) return accept(view());

    const action = input.action;
    const remembered = () => {
      room.processedActions = rememberMultiplayerAction(room.processedActions, action.actionId);
      return accept(snapshot(room, player.id, now));
    };

    if (action.type === "room.leave") {
      if (room.phase === "lobby") {
        room.players = room.players.filter(({ id }) => id !== player.id);
        if (room.players.length === 0) room.expiresAt = now;
      } else {
        player.out = true;
        player.answer = null;
        player.leftAt = now;
        player.tokenHash = hash(token());
        if (gameOver(room)) finish(room, now);
      }
      if (room.hostPlayerId === player.id) transferHost(room, player.id, now);
      changed(room);
      return remembered();
    }

    if (action.type === "player.rename") {
      if (room.phase !== "lobby")
        return reject(view(), "action_unavailable", "Names only change in the lobby");
      if (
        room.players.some(
          (candidate) =>
            candidate.id !== player.id &&
            candidate.name.toLocaleLowerCase() === action.name.toLocaleLowerCase(),
        )
      )
        return reject(view(), "action_unavailable", "That name is already here");
      player.name = action.name;
      changed(room);
      return remembered();
    }

    if (action.type === "readiness.set") {
      if (room.phase !== "lobby")
        return reject(view(), "action_unavailable", "Readiness only changes in the lobby");
      if (multiplayerPlayerReady(player) !== action.ready) {
        setMultiplayerPlayerReady(player, action.ready);
        changed(room);
      }
      return remembered();
    }

    if (action.type === "host.claim") {
      if (
        room.hostDisconnectedSince === null ||
        now - room.hostDisconnectedSince < SAME_BRAIN_HOST_CLAIM_AFTER_MS
      )
        return reject(view(), "action_unavailable", "The host is still here");
      room.hostPlayerId = player.id;
      room.hostDisconnectedSince = null;
      changed(room);
      return remembered();
    }

    if (player.out) return reject(view(), "out_of_game", "You are out of this game");

    if (action.type === "answer.submit" || action.type === "answer.clear") {
      // A prompt beat that has run down but not yet been advanced by a poll should still accept an
      // answer — the player is looking at the question, whatever the clock says.
      if (room.phase !== "submit" && room.phase !== "prompt")
        return reject(view(), "phase_ended", "That round has closed");
      if (action.round !== room.round)
        return reject(view(), "phase_ended", "That round has closed");

      if (action.type === "answer.clear") {
        player.answer = null;
        changed(room);
        return remembered();
      }

      if (!answerIsUsable(action.text))
        return reject(view(), "invalid_answer", "Type a word or two");
      player.answer = action.text.slice(0, SAME_BRAIN_MAX_ANSWER_LENGTH).trim();
      changed(room);
      // Nobody waits out a timer everybody has already beaten.
      if (room.phase === "submit" && everyoneAnswered(room)) closeSubmit(room, now);
      return remembered();
    }

    return reject(view(), "action_unavailable", "Unknown action");
  });

  if (!result) return failure("room_unavailable", "Room unavailable");
  return result;
}

export async function authorizeSameBrainSocket(input: {
  roomId: string;
  credential: string;
  playerId?: string;
}) {
  const loaded = await loadRoom(input.roomId);
  if (!loaded) return false;
  return authenticate(loaded.room, input.credential, input.playerId);
}

export async function closeSameBrainRoom(roomId: string, hostToken: string) {
  const loaded = await loadRoom(roomId);
  if (!loaded || !safeEqual(hostToken, loaded.room.hostHash)) return { ok: false as const };
  await deleteRoom(loaded.room, loaded.keys);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Development only
// ---------------------------------------------------------------------------

export interface SameBrainRoomExport {
  version: 1;
  capturedAt: number;
  /** JSON, so the capture is a file you can read, diff and check into a fixture folder. */
  room: string;
  seats: Array<{ name: string; playerId: string; playerToken: string }>;
}

function developmentOnly() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Same brain room export is not available in production");
}

export async function exportSameBrainRoom(
  roomId: string,
  hostToken: string,
  seats: SameBrainRoomExport["seats"],
): Promise<SameBrainRoomExport | null> {
  developmentOnly();
  const loaded = await loadRoom(roomId);
  if (!loaded || !safeEqual(hostToken, loaded.room.hostHash)) return null;
  return { version: 1, capturedAt: Date.now(), room: JSON.stringify(loaded.room), seats };
}

export async function importSameBrainRoom(captured: SameBrainRoomExport) {
  developmentOnly();
  if (captured.version !== 1) return null;
  const room = JSON.parse(captured.room) as SameBrainRoomState;
  const now = Date.now();
  const shift = now - captured.capturedAt;

  room.roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  room.expiresAt = multiplayerPresenceLeaseExpiresAt(now);
  room.phaseStartedAt += shift;
  if (room.phaseEndsAt !== 0) room.phaseEndsAt += shift;
  room.lastActiveAt = now;
  room.pausedAt = null;
  for (const player of room.players) player.lastSeenAt = now;
  room.joinReceiptIds = [];

  await saveRoom(room);
  return { roomId: room.roomId, seats: captured.seats };
}

/** The host token cannot be recovered from its hash, so a restore mints a new one. */
export async function reissueSameBrainHostToken(roomId: string) {
  developmentOnly();
  const loaded = await loadRoom(roomId);
  if (!loaded) return null;
  const hostToken = token();
  loaded.room.hostHash = hash(hostToken);
  await saveRoom(loaded.room, loaded.keys);
  return hostToken;
}

/**
 * Opens a room already populated, started, and optionally already answered.
 *
 * The answers are the point. A rules corner — three spellings of the sea, a room split down the
 * middle, one person alone — cannot be reached by asking five real people to type the right thing,
 * so the scenario types it for them and the round then scores exactly as it would in a real game.
 */
export async function startSameBrainScenario(input: {
  names: string[];
  rounds?: number;
  toggles?: Partial<SameBrainToggles>;
  timings?: Partial<SameBrainTimings>;
  question?: string;
  answers?: Record<number, string>;
}) {
  developmentOnly();
  const created = await createSameBrainRoom({
    rounds: input.rounds,
    // A scenario opens on a result to be inspected, so the spoken beat is skipped unless the scenario
    // is specifically about it — same reasoning as pinning the reveal open below.
    toggles: { sayItAloud: false, ...input.toggles },
    /**
     * The reveal is held open for as long as the bounds allow, whatever the caller asked for.
     *
     * A scenario is opened to look at a scored round, so the reveal stays open long enough to inspect.
     */
    timings: { ...input.timings, reveal: SAME_BRAIN_TIMING_BOUNDS.reveal[1] },
  });
  const seats: SameBrainRoomExport["seats"] = [];
  for (const name of input.names) {
    const joined = await joinSameBrainRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name,
      joinId: `scenario-${created.roomId}-${name}`,
    });
    if (joined.ok) seats.push({ name, playerId: joined.playerId, playerToken: joined.playerToken });
  }
  if (seats.length < SAME_BRAIN_PLAYER_LIMITS.min)
    return {
      error: `${SAME_BRAIN_PLAYER_LIMITS.min} people is the smallest game`,
      roomId: created.roomId,
      hostToken: created.hostToken,
      seats,
    };

  const now = Date.now();
  await withRoom(created.roomId, (room) => {
    room.round = 0;
    startRound(room, now);
    if (input.question) {
      room.question = input.question;
      room.recentQuestions = [input.question];
    }
    // Straight past the prompt beat: a scenario is opened to look at a result, not a countdown.
    enterPhase(room, "submit", now);
    if (input.answers) {
      for (const [index, text] of Object.entries(input.answers)) {
        const player = room.players[Number(index)];
        if (player) player.answer = text;
      }
      if (everyoneAnswered(room)) closeSubmit(room, now);
    }
  });
  // Answers that filled the room close the round, exactly as in a real game.
  await pump(created.roomId);

  return { error: null, roomId: created.roomId, hostToken: created.hostToken, seats };
}

/** Closes submit for scenarios where only some seats answered. */
export async function closeSameBrainSubmit(roomId: string) {
  developmentOnly();
  await withRoom(roomId, (room) => {
    if (room.phase === "submit" || room.phase === "prompt") closeSubmit(room, Date.now());
  });
  await pump(roomId);
}
