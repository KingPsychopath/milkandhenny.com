import { randomInt } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { liarsRoomRedisKeys } from "./liars-keys";
import {
  createMemoryRoomStore,
  createAvailableMultiplayerRoomId,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerActionSeen,
  multiplayerCredentialsMatch,
  multiplayerRoomExpiresAt,
  multiplayerSnapshotDigest,
  rememberMultiplayerAction,
  remainingMultiplayerRoomTtlSeconds,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import type { MultiplayerLockAttempt } from "../shared/room-primitives.server";
import { multiplayerFailure } from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import { liarsNarration, liarsWordPair } from "./liars-content.server";
import { liarsBoard } from "./liars-words";
import {
  LIARS_CONNECTED_WINDOW_MS,
  LIARS_DEATH_HOLD_MS,
  LIARS_DEATH_LANDS_MS,
  LIARS_DUSK_MS,
  LIARS_HOST_CLAIM_AFTER_MS,
  LIARS_LAST_WORDS_LENGTH,
  LIARS_LAST_WORDS_MS,
  LIARS_MAX_NAME_LENGTH,
  LIARS_MOVEMENT_BEAT_MS,
  LIARS_PLAYER_LIMITS,
  LIARS_REPORT_LEAD_MS,
  LIARS_ROLES,
  liarsActionMoves,
  liarsDealRoles,
  liarsDefaultLineup,
  liarsDefaultTimings,
  liarsDetectWinner,
  liarsFirstGameLineup,
  LIARS_GRAVEYARD_BOARD_MAX,
  LIARS_GRAVEYARD_NOTE_LENGTH,
  liarsGraveyardArmsAt,
  liarsLineupTotal,
  liarsNightDuration,
  liarsPlurality,
  liarsReadsGuilty,
  liarsRoleSide,
  liarsRolesForMode,
  liarsTargetableIds,
  liarsValidateLineup,
  LIARS_DEFAULT_TOGGLES,
} from "./liars-rules";
import type {
  LiarsActionResult,
  LiarsDawnSnapshot,
  LiarsDeathCause,
  LiarsDeathEvent,
  LiarsHistoryEntry,
  LiarsHostAction,
  LiarsJoinResult,
  LiarsGraveyardNote,
  LiarsKnowledgeEntry,
  LiarsLineup,
  LiarsMark,
  LiarsMode,
  LiarsNightReport,
  LiarsPhase,
  LiarsPlayerAction,
  LiarsPlayerSummary,
  LiarsRejectionCode,
  LiarsRole,
  LiarsRoomCredentials,
  LiarsRoomErrorCode,
  LiarsRoomMode,
  LiarsSide,
  LiarsSnapshot,
  LiarsSnapshotResult,
  LiarsTimings,
  LiarsToggles,
} from "./types";

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
  role: LiarsRole | null;
  previousRole?: LiarsRole;
  alive: boolean;
  deathRound: number | null;
  deathCause: LiarsDeathCause | null;
  savedCount: number;
  /** Persisted on tap, not on lock, so a dropped phone still acts on what its owner chose. */
  nightTarget: string | null;
  nightLocked: boolean;
  previousNightTarget: string | null;
  vote: string | null;
  voteLocked: boolean;
  readyToVote: boolean;
  pointedAt: string | null;
  /** Roles this player has asked for in the lobby. Non-binding; the host still decides. */
  roleWishes: LiarsRole[];
  graveyardVote: string | null;
  report: LiarsNightReport | null;
  knowledge: LiarsKnowledgeEntry[];
  lastWords: string | null;
  vigilanteUsed?: boolean;
  guiltPending?: boolean;
  word?: string | null;
  clueDone?: boolean;
}

interface LiarsRoomState {
  roomId: string;
  mode: LiarsMode;
  roomMode: LiarsRoomMode;
  phase: LiarsPhase;
  revision: number;
  sequence: number;
  hostHash: string;
  joinHash: string;
  expiresAt: number;
  gameNumber: number;
  round: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
  nightOpensAt: number | null;
  reportAt: number | null;
  pausedAt: number | null;
  /** The last moment any device was heard from. Drives the dormancy pause. */
  lastActiveAt: number;
  lineup: LiarsLineup;
  /** Set once a host edits it, so joins stop reflowing it back to the standard one. */
  lineupCustom: boolean;
  toggles: LiarsToggles;
  timings: LiarsTimings;
  players: PlayerState[];
  hostPlayerId: string | null;
  hostDisconnectedSince: number | null;
  history: LiarsHistoryEntry[];
  dawn: LiarsDawnSnapshot | null;
  clueOrder: string[];
  clueIndex: number;
  clueRound: number;
  /** Who has confirmed the circle is done. Two different people ends it. */
  clueFinishedBy: string[];
  processedActions: string[];
  joinReceiptIds: string[];
  ejectedJesterId: string | null;
  crewEjections: number;
  imposterEjections: number;
  finalGuessCorrect: boolean | null;
  word: string | null;
  decoyWord: string | null;
  wordCategory: string | null;
  wordBoard: string[];
  recentWords: string[];
  /** Narration templates already used this game, so a five-round night never repeats itself. */
  recentNarrationIds: string[];
  winner: LiarsSide | null;
  lastEjectedName: string | null;
  /** One runoff per day. A second tie really does mean nobody goes. */
  /**
   * The graveyard board. Lives on the room rather than per player, because it outlives its author:
   * a note pinned by the first person to die is still the most useful thing on the screen four
   * rounds later.
   */
  graveyardBoard: LiarsGraveyardNote[];
  revoteUsed: boolean;
  /** Restricts the runoff to whoever actually tied. */
  runoffIds: string[];
  narratorPlayerId: string | null;
}

interface JoinReceipt {
  playerId: string;
  playerToken: string;
  expiresAt: number;
}

const memoryRooms = createMemoryRoomStore<LiarsRoomState>("liars");
const memoryJoinReceipts = createMemoryRoomStore<JoinReceipt>("liars-receipts");
let lockObserver: ((input: MultiplayerLockAttempt) => void) | null = null;

export function setLiarsRoomLockObserver(observer: typeof lockObserver) {
  lockObserver = observer;
}

type LiarsRedisKeys = ReturnType<typeof liarsRoomRedisKeys>;
const token = createMultiplayerCredential;
const hash = hashMultiplayerCredential;
const safeEqual = multiplayerCredentialsMatch;

function changed(room: LiarsRoomState) {
  room.revision += 1;
  room.sequence += 1;
}

function failure(errorCode: LiarsRoomErrorCode, error: string): LiarsActionResult {
  return { ...multiplayerFailure(errorCode, error), accepted: false, snapshot: null };
}

function reject(
  snapshot: LiarsSnapshot,
  errorCode: LiarsRejectionCode,
  error: string,
  retryable = false,
): LiarsActionResult {
  return { ok: true, accepted: false, snapshot, errorCode, error, retryable };
}

function accept(snapshot: LiarsSnapshot): LiarsActionResult {
  return { ok: true, accepted: true, snapshot };
}

function memoryReceiptKey(roomId: string, joinId: string) {
  return `${roomId}:${joinId}`;
}

async function deleteRoom(room: LiarsRoomState, keys: LiarsRedisKeys) {
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
): Promise<{ room: LiarsRoomState; keys: LiarsRedisKeys } | null> {
  const keys = liarsRoomRedisKeys(id);
  const redis = getRedis();
  const room = redis ? await redis.get<LiarsRoomState>(keys.state) : (memoryRooms.get(id) ?? null);
  if (!room) return null;
  if (room.expiresAt <= Date.now()) {
    await deleteRoom(room, keys);
    return null;
  }
  return { room, keys };
}

async function saveRoom(room: LiarsRoomState, keys = liarsRoomRedisKeys(room.roomId)) {
  const redis = getRedis();
  if (room.expiresAt <= Date.now()) {
    await deleteRoom(room, keys);
    return;
  }
  if (redis)
    await redis.set(keys.state, room, { ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt) });
  else memoryRooms.set(room.roomId, room);
}

async function withRoom<T>(
  id: string,
  use: (room: LiarsRoomState, keys: LiarsRedisKeys) => T | Promise<T>,
): Promise<T | null> {
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
  return withMultiplayerRoomLock(
    redis,
    { roomId: id, lockKey: initial.keys.lock, onAttempt: (attempt) => lockObserver?.(attempt) },
    async () => {
      const room = await redis.get<LiarsRoomState>(initial.keys.state);
      if (!room || room.expiresAt <= Date.now()) return null;
      const result = await use(room, initial.keys);
      await saveRoom(room, initial.keys);
      return result;
    },
  );
}

async function readJoinReceipt(roomId: string, joinId: string, keys: LiarsRedisKeys) {
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
  room: LiarsRoomState,
  joinId: string,
  receipt: JoinReceipt,
  keys: LiarsRedisKeys,
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

const living = (room: LiarsRoomState) => room.players.filter(({ alive }) => alive);
const connected = (player: PlayerState, now: number) =>
  now - player.lastSeenAt <= LIARS_CONNECTED_WINDOW_MS;

function narrate(
  room: LiarsRoomState,
  outcome: Parameters<typeof liarsNarration>[0],
  slots: Parameters<typeof liarsNarration>[1],
) {
  const line = liarsNarration(outcome, slots, room.recentNarrationIds ?? []);
  room.recentNarrationIds = [...(room.recentNarrationIds ?? []), line.id].slice(-14);
  return line.text;
}

function note(room: LiarsRoomState, phase: "night" | "day", text: string) {
  room.history.push({ round: room.round, phase, text });
}

function remember(player: PlayerState, round: number, subjectName: string | null, text: string) {
  player.knowledge.push({ round, subjectName, text });
}

function phaseDuration(room: LiarsRoomState, phase: LiarsPhase): number {
  const timings = room.timings;
  switch (phase) {
    case "deal":
      return room.toggles.firstGame ? timings.deal + 20_000 : timings.deal;
    case "night":
      return LIARS_DUSK_MS + liarsNightDuration(timings, living(room).length);
    case "dawn":
      return dawnDuration(room);
    case "clue":
      // One long window at a table, where nothing is tracking individual turns and a per-turn
      // failsafe would silently eat the round out from under a circle that is still going.
      return room.roomMode === "remote"
        ? timings.clueTurn
        : Math.min(12 * 60_000, Math.max(3, living(room).length) * timings.clueTurn);
    case "deliberation":
      return timings.deliberation;
    case "vote":
      return timings.vote;
    case "verdict":
      return timings.verdict;
    case "finalGuess":
      return timings.finalGuess;
    default:
      return 0;
  }
}

function dawnDuration(room: LiarsRoomState) {
  const dawn = room.dawn;
  if (!dawn) return room.timings.dawn;
  // A revive or a substitution needs its second beat; each announced movement gets its own.
  const revive = dawn.deaths.some(({ revived, substituteName }) => revived || substituteName)
    ? 3_000
    : 0;
  return room.timings.dawn + revive + dawn.movementSeen.length * LIARS_MOVEMENT_BEAT_MS;
}

function enterPhase(room: LiarsRoomState, phase: LiarsPhase, now: number) {
  room.phase = phase;
  room.phaseStartedAt = now;
  room.phaseEndsAt = now + phaseDuration(room, phase);
  room.nightOpensAt = phase === "night" ? now + LIARS_DUSK_MS : null;
  room.reportAt = phase === "night" ? room.phaseEndsAt - LIARS_REPORT_LEAD_MS : null;
  changed(room);
}

function clearRoundState(room: LiarsRoomState) {
  for (const player of room.players) {
    player.previousNightTarget = player.nightTarget;
    player.nightTarget = null;
    player.nightLocked = false;
    player.vote = null;
    player.voteLocked = false;
    player.readyToVote = false;
    player.pointedAt = null;
    player.report = null;
    player.clueDone = false;
  }
  room.revoteUsed = false;
  room.runoffIds = [];
}

function startRound(room: LiarsRoomState, now: number) {
  room.round += 1;
  clearRoundState(room);
  room.dawn = null;
  if (room.mode === "imposter") {
    startClueRound(room, now);
    return;
  }
  enterPhase(room, "night", now);
}

function startClueRound(room: LiarsRoomState, now: number) {
  const order = living(room).map(({ id }) => id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  room.clueOrder = order;
  room.clueIndex = 0;
  room.clueRound += 1;
  room.clueFinishedBy = [];
  enterPhase(room, "clue", now);
}

/** Two clue rounds before the first vote when the table is small — one word each is not enough. */
function clueRoundsBeforeVote(room: LiarsRoomState) {
  return room.players.length <= 7 && room.round === 1 ? 2 : 1;
}

function advanceClue(room: LiarsRoomState, now: number) {
  // At a table the window belongs to the whole circle, so running out ends the round rather than
  // nudging an index nobody is watching.
  if (room.roomMode !== "remote" && now >= room.phaseEndsAt) room.clueIndex = room.clueOrder.length;
  else room.clueIndex += 1;
  if (room.clueIndex < room.clueOrder.length) {
    room.phaseStartedAt = now;
    room.phaseEndsAt = now + room.timings.clueTurn;
    changed(room);
    return;
  }
  if (room.clueRound < clueRoundsBeforeVote(room)) {
    startClueRound(room, now);
    return;
  }
  enterPhase(room, "deliberation", now);
}

function finish(room: LiarsRoomState, winner: LiarsSide, now: number) {
  room.winner = winner;
  room.phase = "ending";
  room.phaseStartedAt = now;
  room.phaseEndsAt = now;
  room.expiresAt = Math.min(room.expiresAt, now + FINISHED_GRACE_SECONDS * 1_000);
  changed(room);
}

function checkWinner(room: LiarsRoomState, now: number, ejectedJesterId?: string | null) {
  const winner = liarsDetectWinner({
    mode: room.mode,
    toggles: room.toggles,
    alive: living(room).map(({ id, role }) => ({ playerId: id, role: role ?? "villager" })),
    ejectedJesterId,
    crewEjections: room.crewEjections,
    imposterEjections: room.imposterEjections,
    finalGuessCorrect: room.finalGuessCorrect,
  });
  if (winner) {
    finish(room, winner, now);
    return true;
  }
  return false;
}

/**
 * Lazy advance, run on every read. The room owns no timers; phases move because time has passed.
 * A room nobody is connected to pauses rather than fast-forwarding through rounds of nobody acting.
 */
function advance(room: LiarsRoomState, now = Date.now(), idleFor = 0) {
  if (room.phase === "lobby" || room.phase === "ending") return;
  if (room.pausedAt !== null) return;

  // The room keeps running for one connected window past the last device, then freezes. Without
  // this, a group whose train goes into a tunnel comes back to four rounds nobody was present for.
  const dormant = Math.max(0, idleFor - LIARS_CONNECTED_WINDOW_MS);
  if (dormant > 0) {
    room.phaseStartedAt += dormant;
    room.phaseEndsAt += dormant;
    if (room.nightOpensAt !== null) room.nightOpensAt += dormant;
    if (room.reportAt !== null) room.reportAt += dormant;
    if (room.dawn) {
      room.dawn.nameLandsAt += dormant;
      room.dawn.holdUntil += dormant;
      room.dawn.settleAt += dormant;
      if (room.dawn.reviveAt !== null) room.dawn.reviveAt += dormant;
    }
    changed(room);
  }

  // Bounded, so a clock jump cannot spin here.
  for (let guard = 0; guard < 8; guard += 1) {
    // A transition below may have ended the game; `winner` is what finish() sets alongside the phase.
    if (room.winner !== null) return;
    if (now < room.phaseEndsAt) {
      if (room.phase === "night" && room.reportAt !== null && now >= room.reportAt)
        writeNightReports(room);
      return;
    }
    switch (room.phase) {
      case "deal":
        startRound(room, room.phaseEndsAt);
        break;
      case "night":
        resolveNight(room, room.phaseEndsAt);
        break;
      case "clue":
        advanceClue(room, room.phaseEndsAt);
        break;
      case "dawn":
        enterPhase(room, "deliberation", room.phaseEndsAt);
        break;
      case "deliberation":
        enterPhase(room, "vote", room.phaseEndsAt);
        break;
      case "vote":
        resolveVote(room, room.phaseEndsAt);
        break;
      case "verdict":
        afterVerdict(room, room.phaseEndsAt);
        break;
      case "finalGuess":
        resolveFinalGuess(room, room.phaseEndsAt, null);
        break;
      default:
        return;
    }
  }
}

// ---------------------------------------------------------------------------
// Night
// ---------------------------------------------------------------------------

function visitorsOf(room: LiarsRoomState, targetId: string) {
  return living(room).filter(
    (player) =>
      player.id !== targetId &&
      player.nightTarget === targetId &&
      liarsActionMoves(player.role ?? "villager", player.nightTarget),
  );
}

/** The godfather calls it; once they are gone the longest-surviving mafia does. */
function mafiaCaller(room: LiarsRoomState) {
  const mafia = living(room).filter(({ role }) => role && liarsRoleSide(role) === "mafia");
  return (
    mafia.find(({ role }) => role === "godfather") ??
    mafia.toSorted((left, right) => left.joinedAt - right.joinedAt)[0] ??
    null
  );
}

/** The T−10s card. Every role gets one, even when nothing happened. */
function writeNightReports(room: LiarsRoomState) {
  let wrote = false;
  for (const player of living(room)) {
    if (player.report) continue;
    const role = player.role ?? "villager";
    const definition = LIARS_ROLES[role];
    const target = room.players.find(({ id }) => id === player.nightTarget) ?? null;
    const subjectName = target?.name ?? null;
    let line = "you held";
    let glyph: LiarsNightReport["glyph"] = null;

    if (!target) {
      line = role === "mafia" || role === "godfather" ? "you stayed in" : "you stayed in";
    } else if (role === "detective") {
      line = liarsReadsGuilty(target.role ?? "villager") ? "guilty" : "innocent";
      remember(player, room.round, subjectName, line);
    } else if (role === "lookout") {
      const names = visitorsOf(room, target.id).map(({ name }) => name);
      line =
        names.length === 0 ? "nobody came to their door" : `${joinNames(names)} came to their door`;
      remember(player, room.round, subjectName, line);
    } else if (role === "villager" || role === "jester") {
      const moved = liarsActionMoves(target.role ?? "villager", target.nightTarget);
      line = moved ? "they went out" : "their door didn't open";
      glyph = moved ? "moved" : "still";
      remember(player, room.round, subjectName, line);
    } else if (definition.reportVerb) {
      line = definition.reportVerb;
    }

    player.report = { id: token(12), subjectName, line, glyph };
    wrote = true;
  }
  if (wrote) changed(room);
}

function joinNames(names: string[]) {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function kill(room: LiarsRoomState, player: PlayerState, cause: LiarsDeathCause) {
  player.alive = false;
  player.deathRound = room.round;
  player.deathCause = cause;
  if (room.toggles.lastWords) {
    player.lastWords = null;
  }
}

function resolveNight(room: LiarsRoomState, now: number) {
  writeNightReports(room);

  const alive = living(room);
  const byId = new Map(alive.map((player) => [player.id, player]));
  const roleHolder = (role: LiarsRole) => alive.find((player) => player.role === role) ?? null;

  const jammer = roleHolder("jammer");
  const blockedId = jammer?.nightTarget ?? null;
  const isBlocked = (player: PlayerState | null) => Boolean(player && player.id === blockedId);
  if (blockedId && byId.get(blockedId))
    remember(byId.get(blockedId)!, room.round, null, "your night was interrupted");

  const doctor = roleHolder("doctor");
  const savedId = isBlocked(doctor) ? null : (doctor?.nightTarget ?? null);
  const bodyguard = roleHolder("bodyguard");
  const guardedId = isBlocked(bodyguard) ? null : (bodyguard?.nightTarget ?? null);
  const escort = roleHolder("escort");
  const escortTargetId = isBlocked(escort) ? null : (escort?.nightTarget ?? null);

  const caller = mafiaCaller(room);
  const mafiaTargetId = isBlocked(caller) ? null : (caller?.nightTarget ?? null);
  const vigilante = roleHolder("vigilante");
  const vigilanteTargetId =
    isBlocked(vigilante) || vigilante?.vigilanteUsed ? null : (vigilante?.nightTarget ?? null);

  const deaths: LiarsDeathEvent[] = [];
  /** Last words the server writes rather than a player, published with the dawn that caused them. */
  const testimony: Array<{ name: string; text: string }> = [];
  const attacks: Array<{ targetId: string; attacker: PlayerState | null; fromMafia: boolean }> = [];
  if (mafiaTargetId && caller)
    attacks.push({ targetId: mafiaTargetId, attacker: caller, fromMafia: true });
  if (vigilanteTargetId && vigilante) {
    attacks.push({ targetId: vigilanteTargetId, attacker: vigilante, fromMafia: false });
    vigilante.vigilanteUsed = true;
  }

  for (const attack of attacks) {
    const target = byId.get(attack.targetId);
    if (!target || !target.alive) continue;
    // The escort's own house is empty — a kill aimed at them misses.
    if (escort && target.id === escort.id && escortTargetId) continue;

    // Anyone spending the night there sees who came.
    if (escort && escortTargetId === target.id && attack.attacker) {
      remember(escort, room.round, target.name, `it was ${attack.attacker.name}`);
      escort.report = {
        id: token(12),
        subjectName: target.name,
        line: `it was ${attack.attacker.name}`,
        glyph: null,
      };
    }

    if (savedId === target.id) {
      target.savedCount += 1;
      deaths.push({
        playerId: target.id,
        name: target.name,
        revived: true,
        substituteName: null,
        cause: "killed",
      });
      continue;
    }

    if (guardedId === target.id && bodyguard && bodyguard.alive) {
      kill(room, bodyguard, "bodyguard");
      deaths.push({
        playerId: target.id,
        name: target.name,
        revived: false,
        substituteName: bodyguard.name,
        cause: "killed",
      });
      continue;
    }

    kill(room, target, "killed");
    deaths.push({
      playerId: target.id,
      name: target.name,
      revived: false,
      substituteName: null,
      cause: "killed",
      ...(room.toggles.revealRoleOnDeath && target.role ? { role: target.role } : {}),
    });

    // The escort saw too much and dies with them — and their report publishes as testimony.
    if (escort && escortTargetId === target.id && escort.alive) {
      kill(room, escort, "killed");
      if (attack.attacker) {
        escort.lastWords = `I was there. It was ${attack.attacker.name}.`;
        // Collected here and seeded into the dawn below. Setting it on the player alone was not
        // enough: `room.dawn` at this point is still last night's, and only the `words.last`
        // action ever pushed into the current one — so the line existed on the corpse and reached
        // nobody. The whole role is the promise that dying still delivers the name.
        testimony.push({ name: escort.name, text: escort.lastWords });
      }
      deaths.push({
        playerId: escort.id,
        name: escort.name,
        revived: false,
        substituteName: null,
        cause: "killed",
        ...(room.toggles.revealRoleOnDeath ? { role: "escort" as LiarsRole } : {}),
      });
    }

    if (!attack.fromMafia && vigilante && liarsRoleSide(target.role ?? "villager") !== "mafia")
      vigilante.guiltPending = true;
  }

  // Guilt lands the night after the mistake.
  const guilty = alive.find((player) => player.guiltPending && player.alive);
  if (guilty && guilty.vigilanteUsed && guilty.deathRound === null && room.round > 1) {
    kill(room, guilty, "guilt");
    deaths.push({
      playerId: guilty.id,
      name: guilty.name,
      revived: false,
      substituteName: null,
      cause: "guilt",
    });
  }

  const movementSeen = corroboratedMovement(room);
  const victim = deaths.find(({ revived, substituteName }) => !revived && !substituteName);
  const substituted = deaths.find(({ substituteName }) => substituteName);
  const revived = deaths.find(({ revived: wasRevived }) => wasRevived);
  const witnessCount = victim ? visitorsOf(room, victim.playerId).length : null;

  const narration = substituted
    ? narrate(room, "bodyguard", {
        victim: substituted.name,
        substitute: substituted.substituteName ?? undefined,
      })
    : revived && room.toggles.announceAttackTarget
      ? narrate(room, "saved", { victim: revived.name })
      : revived
        ? "Somebody was attacked last night, and somebody saved them."
        : victim
          ? narrate(room, "killed", { victim: victim.name })
          : narrate(room, "nobody-died", {});

  const nameLandsAt = now + LIARS_DEATH_LANDS_MS;
  room.dawn = {
    narration,
    nameLandsAt,
    holdUntil: nameLandsAt + LIARS_DEATH_HOLD_MS,
    reviveAt: revived ? nameLandsAt + LIARS_DEATH_HOLD_MS : null,
    settleAt: nameLandsAt + LIARS_DEATH_HOLD_MS + 4_000,
    // With the announcement off, the table sees that somebody was attacked but not who.
    deaths: room.toggles.announceAttackTarget
      ? deaths
      : deaths.filter(({ revived: wasRevived }) => !wasRevived),
    movementSeen,
    witnessCount,
    lastWords: testimony,
  };
  note(room, "night", narration);
  for (const name of movementSeen) note(room, "night", `${name} was seen moving.`);

  enterPhase(room, "dawn", now);
  checkWinner(room, now);
}

/**
 * Two or more watchers on the same person makes it public. Announced only on movement — announcing
 * stillness would publicly clear the plain villagers every night, which is a gift to the mafia.
 */
function corroboratedMovement(room: LiarsRoomState) {
  const watchers = new Map<string, number>();
  for (const player of living(room)) {
    const role = player.role ?? "villager";
    if (LIARS_ROLES[role].moves || !player.nightTarget) continue;
    watchers.set(player.nightTarget, (watchers.get(player.nightTarget) ?? 0) + 1);
  }
  const seen: string[] = [];
  for (const [targetId, count] of watchers) {
    if (count < 2) continue;
    const target = room.players.find(({ id }) => id === targetId);
    if (!target) continue;
    if (!liarsActionMoves(target.role ?? "villager", target.nightTarget)) continue;
    seen.push(target.name);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Day
// ---------------------------------------------------------------------------

/**
 * How split the graveyard is right now.
 *
 * Extracted rather than inlined because the dead need to be told before verdict, not after. A
 * graveyard that discovers at the last second that it tied and did nothing has spent its whole
 * turn on a shrug.
 */
function graveyardStanding(room: LiarsRoomState) {
  const dead = room.players.filter(({ alive }) => !alive);
  const tally = new Map<string, number>();
  for (const { graveyardVote } of dead) {
    if (!graveyardVote) continue;
    tally.set(graveyardVote, (tally.get(graveyardVote) ?? 0) + 1);
  }
  const best = Math.max(0, ...tally.values());
  const leaders = [...tally].filter(([, count]) => count === best).length;
  return {
    deadlocked: best > 0 && leaders > 1,
    abstaining: dead.filter(({ graveyardVote }) => graveyardVote === null).length,
  };
}

function graveyardBallot(room: LiarsRoomState): string | null {
  if (!room.toggles.graveyardVote || room.toggles.liveGodView) return null;
  const dead = room.players.filter(({ alive }) => !alive);
  if (dead.length < liarsGraveyardArmsAt(room.players.length)) return null;
  return liarsPlurality(dead.map(({ graveyardVote }) => ({ targetId: graveyardVote })));
}

/** Everybody level at the top, which is what a tie actually is. */
function tiedIds(votes: Array<{ targetId: string | null }>) {
  const tally = new Map<string, number>();
  for (const { targetId } of votes) {
    if (!targetId) continue;
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  const best = Math.max(0, ...tally.values());
  return best === 0 ? [] : [...tally].filter(([, count]) => count === best).map(([id]) => id);
}

function resolveVote(room: LiarsRoomState, now: number) {
  const ballots = living(room).map(({ vote }) => ({ targetId: vote }));
  const graveyard = graveyardBallot(room);
  if (graveyard) ballots.push({ targetId: graveyard });

  const ejectedId = liarsPlurality(ballots);
  const ejected = room.players.find(({ id }) => id === ejectedId) ?? null;
  room.lastEjectedName = ejected?.name ?? null;
  room.ejectedJesterId = null;

  if (!ejected) {
    const tied = tiedIds(ballots);
    // A tie used to end the day, which is the least satisfying way for a vote to go. One runoff
    // between whoever tied, then it stands.
    if (!room.revoteUsed && tied.length > 1) {
      room.revoteUsed = true;
      room.runoffIds = tied;
      for (const player of room.players) {
        player.vote = null;
        player.voteLocked = false;
      }
      note(
        room,
        "day",
        `Level between ${tied
          .map((id) => room.players.find(({ id: playerId }) => playerId === id)?.name)
          .filter(Boolean)
          .join(" and ")}. Again.`,
      );
      enterPhase(room, "vote", now);
      return;
    }
    note(room, "day", narrate(room, "tie", {}));
    enterPhase(room, "verdict", now);
    return;
  }

  kill(room, ejected, "ejected");
  const role = ejected.role ?? "villager";
  if (role === "jester") room.ejectedJesterId = ejected.id;
  if (room.mode === "imposter") {
    if (liarsRoleSide(role) === "mafia") room.imposterEjections += 1;
    else room.crewEjections += 1;
  }
  note(
    room,
    "day",
    narrate(room, liarsRoleSide(role) === "mafia" ? "ejected-guilty" : "ejected-innocent", {
      ejected: ejected.name,
    }),
  );
  enterPhase(room, "verdict", now);
}

function afterVerdict(room: LiarsRoomState, now: number) {
  if (checkWinner(room, now, room.ejectedJesterId)) return;
  // The last imposter out gets one shot at the word before the crew can be declared right.
  if (room.mode === "imposter" && lastImposterJustEjected(room)) {
    room.finalGuessCorrect = null;
    enterPhase(room, "finalGuess", now);
    return;
  }
  startRound(room, now);
}

function lastImposterJustEjected(room: LiarsRoomState) {
  const imposterAlive = living(room).some(({ role }) => role && liarsRoleSide(role) === "mafia");
  return !imposterAlive && room.imposterEjections > 0 && room.finalGuessCorrect === undefined
    ? true
    : !imposterAlive && room.imposterEjections > 0 && room.finalGuessCorrect === null;
}

function resolveFinalGuess(room: LiarsRoomState, now: number, guess: string | null) {
  const target = (room.word ?? "").trim().toLocaleLowerCase();
  const attempt = (guess ?? "").trim().toLocaleLowerCase();
  room.finalGuessCorrect = attempt.length > 0 && attempt === target;
  note(
    room,
    "day",
    room.finalGuessCorrect
      ? `They named it. The word was ${room.word}.`
      : `They could not name it. The word was ${room.word}.`,
  );
  if (!checkWinner(room, now)) finish(room, "town", now);
}

// ---------------------------------------------------------------------------
// Snapshot — the security boundary
// ---------------------------------------------------------------------------

function marksFor(room: LiarsRoomState, player: PlayerState): LiarsMark[] {
  const marks: LiarsMark[] = [];
  const dawn = room.dawn;
  if (dawn) {
    if (dawn.movementSeen.includes(player.name)) marks.push("moved");
    const death = dawn.deaths.find(({ playerId }) => playerId === player.id);
    if (death?.revived) marks.push("saved");
    // Only worth marking on somebody still standing. The dead already carry a strikethrough and a
    // cross, and a second cross beside it reads as two different things having happened.
    if (death && !death.revived && player.alive) marks.push("attacked");
  }
  if (room.players.some((other) => other.alive && other.pointedAt === player.id))
    marks.push("pointed");
  return marks;
}

function maySeeRole(
  room: LiarsRoomState,
  viewer: PlayerState | null,
  subject: PlayerState,
): boolean {
  if (room.phase === "ending") return true;
  if (!viewer) return false;
  if (viewer.id === subject.id) return true;
  if (!viewer.alive && room.toggles.liveGodView) return true;
  if (!subject.alive) {
    if (subject.deathCause === "ejected") return room.toggles.revealEjectedRole;
    return room.toggles.revealRoleOnDeath;
  }
  // Teammates. Blind imposters are strangers to each other by design.
  const viewerRole = viewer.role;
  const subjectRole = subject.role;
  if (!viewerRole || !subjectRole) return false;
  if (liarsRoleSide(viewerRole) !== "mafia" || liarsRoleSide(subjectRole) !== "mafia") return false;
  if (room.mode === "imposter") {
    if (room.toggles.blindImposters) return false;
    // The imposter is never told the mole exists; the mole is told everything.
    if (viewerRole === "imposter" && subjectRole === "mole") return false;
  }
  return true;
}

function summaryOf(
  room: LiarsRoomState,
  viewer: PlayerState | null,
  player: PlayerState,
  now: number,
): LiarsPlayerSummary {
  return {
    id: player.id,
    name: player.name,
    alive: player.alive,
    connected: connected(player, now),
    ready: multiplayerPlayerReady(player),
    host: room.hostPlayerId === player.id,
    ...(maySeeRole(room, viewer, player) && player.role ? { role: player.role } : {}),
    deathRound: player.deathRound,
    deathCause: player.deathCause,
    marks: marksFor(room, player),
    savedCount: player.savedCount,
    ...(room.phase === "verdict" || room.phase === "ending"
      ? { votes: living(room).filter(({ vote }) => vote === player.id).length }
      : {}),
  };
}

function endingOf(room: LiarsRoomState) {
  if (room.phase !== "ending" || !room.winner) return null;
  const awards: Array<{ label: string; name: string; detail: string }> = [];
  const mostVoted = room.players
    .filter(({ deathCause }) => deathCause === "ejected")
    .map(({ name }) => name);
  if (mostVoted.length > 0)
    awards.push({ label: "voted out", name: mostVoted[0], detail: "the town's first answer" });
  const doctor = room.players.find(({ role }) => role === "doctor");
  if (doctor)
    awards.push({
      label: "the doctor",
      name: doctor.name,
      detail: `${room.players.reduce((total, { savedCount }) => total + savedCount, 0)} saved`,
    });
  return {
    winner: room.winner,
    headline:
      room.winner === "third"
        ? "The jester wins. Alone."
        : room.winner === "town"
          ? room.mode === "mafia"
            ? "The town wins."
            : "The crew wins."
          : room.mode === "mafia"
            ? "The mafia win."
            : "The imposters win.",
    roles: room.players.map(({ id, name, role }) => ({
      playerId: id,
      name,
      role: role ?? "villager",
    })),
    log: room.history,
    awards,
    word: room.mode === "imposter" ? room.word : null,
  };
}

function snapshot(room: LiarsRoomState, viewerId?: string, now = Date.now()): LiarsSnapshot {
  const viewer = room.players.find(({ id }) => id === viewerId) ?? null;
  const alive = living(room);
  const dead = room.players.filter(({ alive: isAlive }) => !isAlive);
  const graveyardArmsAt = liarsGraveyardArmsAt(room.players.length);
  const standing = graveyardStanding(room);
  const lastWordsOpen = Boolean(
    viewer &&
    room.toggles.lastWords &&
    !viewer.alive &&
    viewer.lastWords === null &&
    viewer.deathRound === room.round,
  );

  const allyIds =
    viewer?.role && liarsRoleSide(viewer.role) === "mafia"
      ? room.players
          .filter(
            (other) =>
              other.id !== viewer.id &&
              maySeeRole(room, viewer, other) &&
              other.role &&
              liarsRoleSide(other.role) === "mafia",
          )
          .map(({ id }) => id)
      : [];

  return {
    roomId: room.roomId,
    mode: room.mode,
    roomMode: room.roomMode,
    phase: room.phase,
    revision: room.revision,
    sequence: room.sequence,
    serverNow: now,
    expiresAt: room.expiresAt,
    gameNumber: room.gameNumber,
    round: room.round,
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    nightOpensAt: room.nightOpensAt,
    reportAt: room.reportAt,
    lineup: room.lineup,
    toggles: room.toggles,
    players: room.players.map((player) => summaryOf(room, viewer, player, now)),
    actedCount: alive.filter(({ nightLocked }) => nightLocked).length,
    livingCount: alive.length,
    readyToVoteCount: alive.filter(({ readyToVote }) => readyToVote).length,
    history: room.history,
    dawn: room.dawn,
    clue:
      room.phase === "clue"
        ? {
            currentPlayerId: room.clueOrder[room.clueIndex] ?? null,
            order: room.clueOrder,
            doneIds: room.clueOrder.slice(0, room.clueIndex),
            round: room.clueRound,
            advancesAt: room.phaseEndsAt,
            handoff: room.roomMode === "remote" ? "each-turn" : "one-tap",
            finishedBy: room.clueFinishedBy ?? [],
          }
        : null,
    // The living never receive the graveyard's deliberations, only its ballot at verdict.
    graveyard:
      viewer && !viewer.alive
        ? {
            armed: dead.length >= graveyardArmsAt,
            armsWhenDeadReaches: graveyardArmsAt,
            deadCount: dead.length,
            tally: room.players
              .filter(({ alive: isAlive }) => isAlive)
              .map((candidate) => ({
                playerId: candidate.id,
                name: candidate.name,
                votes: dead.filter(({ graveyardVote }) => graveyardVote === candidate.id).length,
              }))
              .filter(({ votes }) => votes > 0),
            yourVote: viewer.graveyardVote,
            deadlocked: standing.deadlocked,
            abstaining: standing.abstaining,
            board: room.graveyardBoard,
            boardMax: LIARS_GRAVEYARD_BOARD_MAX,
          }
        : null,
    /*
     * Lobby only, and every role the mode offers rather than only the ones already in — "what is
     * off" was previously not on screen anywhere, so there was no way to ask for something you
     * could not see. `available` carries the reason a role cannot simply be switched on, which is
     * almost always that the room is too small for it.
     */
    roleWishes:
      room.phase === "lobby"
        ? liarsRolesForMode(room.mode).map((definition) => ({
            role: definition.id,
            active: (room.lineup.roles[definition.id] ?? 0) > 0,
            count: room.players.filter(({ roleWishes }) => roleWishes.includes(definition.id))
              .length,
            yours: viewer?.roleWishes.includes(definition.id) ?? false,
            available: room.players.length >= definition.minPlayers,
          }))
        : [],
    ending: endingOf(room),
    narratorPlayerId: room.narratorPlayerId,
    hostPlayerId: room.hostPlayerId,
    hostDisconnectedSince: room.hostDisconnectedSince,
    player: viewer
      ? {
          playerId: viewer.id,
          ready: multiplayerPlayerReady(viewer),
          startRequestId: viewer.startRequestId ?? null,
          role: viewer.role ?? "villager",
          alive: viewer.alive,
          allyIds,
          allyTargets: allyIds.map((allyId) => {
            const ally = room.players.find(({ id }) => id === allyId)!;
            return { playerId: allyId, targetId: ally.nightTarget, locked: ally.nightLocked };
          }),
          callerPlayerId:
            viewer.role && liarsRoleSide(viewer.role) === "mafia" && room.mode === "mafia"
              ? (mafiaCaller(room)?.id ?? null)
              : null,
          word: viewer.word ?? null,
          wordCategory: room.mode === "imposter" ? (room.wordCategory ?? null) : null,
          wordBoard:
            room.mode === "imposter" && room.toggles.wordBoard ? (room.wordBoard ?? []) : [],
          nightTarget: viewer.nightTarget,
          nightLocked: viewer.nightLocked,
          vote: viewer.vote,
          voteLocked: viewer.voteLocked,
          readyToVote: viewer.readyToVote,
          pointedAt: viewer.pointedAt,
          // Held back until the report moment, so the card cannot be read early.
          report:
            room.phase === "night" && room.reportAt !== null && now < room.reportAt
              ? null
              : viewer.report,
          // Sealed once your last words close. Everything in here is server-issued and therefore
          // provable, and a dead player who can hand an unlocked phone to a living one has a
          // channel that beats every rule in the game — last words are one line and can be a lie,
          // a screen reading `round 2 · Maya · mafia` cannot. Death has to cost you the ability to
          // prove things, or it costs you nothing at all.
          knowledge: viewer.alive || lastWordsOpen ? viewer.knowledge : [],
          knowledgeSealed: !viewer.alive && !lastWordsOpen && viewer.knowledge.length > 0,
          targetableIds:
            room.phase === "night" && viewer.alive && viewer.role
              ? liarsTargetableIds({
                  mode: room.mode,
                  role: viewer.role,
                  actorId: viewer.id,
                  living: alive.map(({ id, role }) => ({ playerId: id, role: role ?? "villager" })),
                  previousTargetId: viewer.previousNightTarget,
                  toggles: room.toggles,
                })
              : [],
          lastWordsOpen,
          lastWordsClosesAt:
            room.dawn && !viewer.alive ? room.dawn.settleAt + LIARS_LAST_WORDS_MS : null,
          finalGuessOpen:
            room.phase === "finalGuess" &&
            !viewer.alive &&
            Boolean(viewer.role && liarsRoleSide(viewer.role) === "mafia"),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createLiarsRoom(input: {
  mode: LiarsMode;
  roomMode: LiarsRoomMode;
  toggles?: Partial<LiarsToggles>;
  timings?: Partial<LiarsTimings>;
}): Promise<LiarsRoomCredentials> {
  const hostToken = token();
  const joinToken = token();
  const expiresAt = multiplayerRoomExpiresAt();
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const toggles = { ...LIARS_DEFAULT_TOGGLES, ...input.toggles };
  const room: LiarsRoomState = {
    roomId,
    mode: input.mode,
    roomMode: input.roomMode,
    phase: "lobby",
    revision: 1,
    sequence: 1,
    hostHash: hash(hostToken),
    joinHash: hash(joinToken),
    expiresAt,
    gameNumber: 1,
    round: 0,
    phaseStartedAt: Date.now(),
    phaseEndsAt: 0,
    nightOpensAt: null,
    reportAt: null,
    pausedAt: null,
    lastActiveAt: Date.now(),
    lineup: liarsDefaultLineup(input.mode, LIARS_PLAYER_LIMITS[input.mode].min),
    lineupCustom: false,
    toggles,
    timings: { ...liarsDefaultTimings(input.roomMode), ...input.timings },
    players: [],
    hostPlayerId: null,
    hostDisconnectedSince: null,
    history: [],
    dawn: null,
    clueOrder: [],
    clueIndex: 0,
    clueRound: 0,
    clueFinishedBy: [],
    processedActions: [],
    joinReceiptIds: [],
    ejectedJesterId: null,
    crewEjections: 0,
    imposterEjections: 0,
    finalGuessCorrect: null,
    word: null,
    decoyWord: null,
    wordCategory: null,
    wordBoard: [],
    recentWords: [],
    recentNarrationIds: [],
    winner: null,
    lastEjectedName: null,
    graveyardBoard: [],
    revoteUsed: false,
    runoffIds: [],
    narratorPlayerId: null,
  };
  if (!getRedis() && process.env.NODE_ENV === "production")
    throw new Error("Liars rooms require Redis");
  await saveRoom(room);
  log.info("things.liars", "Room created", { mode: input.mode, roomMode: input.roomMode });
  return { roomId, hostToken, joinToken, expiresAt };
}

export async function joinLiarsRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
  joinId: string;
  hostToken?: string;
}): Promise<LiarsJoinResult> {
  const result = await withRoom(input.roomId, async (room, keys) => {
    if (input.joinToken !== undefined && !safeEqual(input.joinToken, room.joinHash))
      return { errorCode: "invite_expired", error: "Invite expired" } as const;
    if (room.phase !== "lobby")
      return { errorCode: "game_started", error: "This game has already started" } as const;

    const receipt = await readJoinReceipt(room.roomId, input.joinId, keys);
    if (receipt)
      return {
        receipt,
        snapshot: snapshot(room, receipt.playerId),
        expiresAt: room.expiresAt,
      };

    const name = input.name.trim().replace(/\s+/g, " ");
    if (name.length < 1) return { errorCode: "invalid_name", error: "Enter your name" } as const;
    if (name.length > LIARS_MAX_NAME_LENGTH)
      return {
        errorCode: "invalid_name",
        error: `Use ${LIARS_MAX_NAME_LENGTH} characters or fewer`,
      } as const;
    if (room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
      return { errorCode: "name_taken", error: "That name is already in the room" } as const;
    if (room.players.length >= LIARS_PLAYER_LIMITS[room.mode].max)
      return { errorCode: "room_full", error: "This room is full" } as const;

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
      role: null,
      alive: true,
      deathRound: null,
      deathCause: null,
      savedCount: 0,
      nightTarget: null,
      nightLocked: false,
      previousNightTarget: null,
      vote: null,
      voteLocked: false,
      readyToVote: false,
      pointedAt: null,
      roleWishes: [],
      graveyardVote: null,
      report: null,
      knowledge: [],
      lastWords: null,
    };
    room.players.push(player);
    if (input.hostToken && safeEqual(input.hostToken, room.hostHash)) room.hostPlayerId = player.id;
    room.hostPlayerId ??= player.id;
    // The board follows the roster until it starts. A host's own lineup is kept while it still adds
    // up; once another person arrives it cannot, so it reverts rather than silently not fitting.
    if (!room.lineupCustom || liarsLineupTotal(room.lineup) !== room.players.length) {
      room.lineup = room.toggles.firstGame
        ? liarsFirstGameLineup(room.mode, room.players.length)
        : liarsDefaultLineup(room.mode, room.players.length);
      room.lineupCustom = false;
    }

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
  return multiplayerFailure(result.errorCode, result.error ?? "Could not join");
}

function authenticate(room: LiarsRoomState, credential: string, playerId?: string) {
  const player = room.players.find(({ id }) => id === playerId);
  if (player) return safeEqual(credential, player.tokenHash);
  return safeEqual(credential, room.hostHash);
}

function touch(room: LiarsRoomState, playerId: string | undefined, now: number) {
  const idleFor = Math.max(0, now - (room.lastActiveAt || now));
  room.lastActiveAt = now;
  const player = room.players.find(({ id }) => id === playerId);
  if (player) player.lastSeenAt = now;
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  room.hostDisconnectedSince =
    host && !connected(host, now) ? (room.hostDisconnectedSince ?? now) : null;
  // Narration goes to one device, or several phones echo a beat apart.
  const eligible = room.players.filter((candidate) => connected(candidate, now));
  if (!room.narratorPlayerId || !eligible.some(({ id }) => id === room.narratorPlayerId))
    room.narratorPlayerId = eligible[0]?.id ?? null;
  return idleFor;
}

export async function readLiarsSnapshot(input: {
  roomId: string;
  credential: string;
  playerId?: string;
  lastSequence: number;
  /** What this viewer already holds. Matching it means the body can be left off entirely. */
  lastDigest?: string | null;
}): Promise<LiarsSnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    if (!authenticate(room, input.credential, input.playerId))
      return { ...multiplayerFailure("room_unavailable", "Room unavailable"), snapshot: null };
    const now = Date.now();
    const idleFor = touch(room, input.playerId, now);
    advance(room, now, idleFor);
    const view = snapshot(room, input.playerId, now);
    // Hashed after redaction, so it is a digest of what this viewer sees rather than of the room —
    // two players in the same room hold different snapshots and must not share a digest.
    view.digest = multiplayerSnapshotDigest(view);
    if (input.lastDigest && input.lastDigest === view.digest)
      return { ok: true as const, unchanged: true as const, serverNow: now, snapshot: null };
    return { ok: true as const, snapshot: view };
  });
  return (
    result ?? { ...multiplayerFailure("room_unavailable", "Room unavailable"), snapshot: null }
  );
}

function dealGame(room: LiarsRoomState, now: number, forcedRoles?: Record<string, LiarsRole>) {
  const playerIds = room.players.map(({ id }) => id);
  const previousRoles = Object.fromEntries(
    room.players.flatMap((player) =>
      player.previousRole ? [[player.id, player.previousRole]] : [],
    ),
  ) as Record<string, LiarsRole>;
  // A scenario may pin the deal so that "the escort walks into the mafia's kill" is a starting
  // position rather than something you wait for. Only reachable from the dev-only entry point.
  const dealt =
    forcedRoles ??
    liarsDealRoles({
      lineup: room.lineup,
      playerIds,
      previousRoles: Object.keys(previousRoles).length > 0 ? previousRoles : undefined,
      pick: (bound) => randomInt(bound),
    });

  // The board clears with the deal, not with the round: a note is worth more the longer it lives.
  room.graveyardBoard = [];

  const pair = room.mode === "imposter" ? liarsWordPair(room.recentWords) : null;
  room.word = pair?.word ?? null;
  room.decoyWord = pair?.decoy ?? null;
  room.wordCategory = pair?.category ?? null;
  room.wordBoard = pair ? liarsBoard(pair, (bound) => randomInt(bound), pair.decoy) : [];
  if (pair) room.recentWords = [...room.recentWords, pair.word].slice(-40);

  for (const player of room.players) {
    player.role = dealt[player.id];
    player.alive = true;
    player.deathRound = null;
    player.deathCause = null;
    player.savedCount = 0;
    player.knowledge = [];
    player.lastWords = null;
    player.graveyardVote = null;
    player.vigilanteUsed = false;
    player.guiltPending = false;
    player.previousNightTarget = null;
    player.word =
      room.mode === "imposter"
        ? player.role === "imposter"
          ? null
          : player.role === "understudy"
            ? room.decoyWord
            : room.word
        : null;
  }
  room.round = 0;
  room.history = [];
  room.dawn = null;
  room.crewEjections = 0;
  room.imposterEjections = 0;
  room.finalGuessCorrect = null;
  room.ejectedJesterId = null;
  room.winner = null;
  room.clueRound = 0;
  enterPhase(room, "deal", now);
}

export async function applyLiarsHostAction(input: {
  roomId: string;
  hostToken?: string;
  playerId?: string;
  playerToken?: string;
  action: LiarsHostAction;
}): Promise<LiarsActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const now = Date.now();
    const byToken = input.hostToken && safeEqual(input.hostToken, room.hostHash);
    const actor = room.players.find(({ id }) => id === input.playerId) ?? null;
    const byPlayer =
      actor && input.playerToken && safeEqual(input.playerToken, actor.tokenHash)
        ? actor.id === room.hostPlayerId
        : false;
    if (!byToken && !byPlayer) return failure("room_unavailable", "Room unavailable");
    const idleFor = touch(room, actor?.id, now);
    advance(room, now, idleFor);
    const view = () => snapshot(room, input.playerId, now);
    if (multiplayerActionSeen(room.processedActions, input.action.actionId)) return accept(view());

    const action = input.action;
    if (action.type === "game.configure") {
      if (room.phase !== "lobby")
        return reject(view(), "action_unavailable", "The game has already started");
      if (action.roomMode) {
        room.roomMode = action.roomMode;
        room.timings = {
          ...liarsDefaultTimings(action.roomMode),
          ...room.timings,
          deliberation: liarsDefaultTimings(action.roomMode).deliberation,
        };
      }
      if (action.toggles) {
        room.toggles = { ...room.toggles, ...action.toggles };
        // The two are incompatible: a graveyard that can see roles is a guaranteed-correct ballot.
        if (room.toggles.liveGodView) room.toggles.graveyardVote = false;
        if (action.toggles.firstGame !== undefined)
          room.lineup = action.toggles.firstGame
            ? liarsFirstGameLineup(room.mode, room.players.length)
            : liarsDefaultLineup(room.mode, room.players.length);
      }
      if (action.timings) room.timings = { ...room.timings, ...action.timings };
      if (action.resetLineup) {
        room.lineup = room.toggles.firstGame
          ? liarsFirstGameLineup(room.mode, room.players.length)
          : liarsDefaultLineup(room.mode, room.players.length);
        room.lineupCustom = false;
        changed(room);
      }
      if (action.lineup) {
        const check = liarsValidateLineup(room.mode, action.lineup, room.players.length);
        if (!check.ok) return reject(view(), "lineup_invalid", check.problem.message);
        room.lineup = action.lineup;
        room.lineupCustom = true;
      }
      changed(room);
    } else if (action.type === "game.start") {
      if (room.phase !== "lobby")
        return reject(view(), "action_unavailable", "The game has already started");
      if (room.players.length < LIARS_PLAYER_LIMITS[room.mode].min)
        return reject(
          view(),
          "action_unavailable",
          `${room.mode} needs ${LIARS_PLAYER_LIMITS[room.mode].min} players`,
          true,
        );
      const check = liarsValidateLineup(room.mode, room.lineup, room.players.length);
      if (!check.ok) return reject(view(), "lineup_invalid", check.problem.message);
      const unready = multiplayerUnreadyPlayers(room.players);
      // Nudge once, then let the host through. Waiting on a phone in somebody's pocket is a worse
      // failure than starting without them, and the host is the one who can see the room.
      if (unready.length > 0 && !action.force) {
        if (requestMultiplayerReadiness(unready, token())) changed(room);
        const names = unready.map(({ name }) => name).join(", ");
        return reject(
          view(),
          "players_not_ready",
          unready.length === 1 ? `${names} is not ready` : `${names} are not ready`,
          true,
        );
      }
      dealGame(room, now);
    } else if (action.type === "phase.extend") {
      room.phaseEndsAt += 30_000;
      changed(room);
    } else if (action.type === "phase.pause") {
      room.pausedAt = now;
      changed(room);
    } else if (action.type === "phase.resume") {
      if (room.pausedAt !== null) {
        const shift = now - room.pausedAt;
        room.phaseStartedAt += shift;
        room.phaseEndsAt += shift;
        if (room.nightOpensAt !== null) room.nightOpensAt += shift;
        if (room.reportAt !== null) room.reportAt += shift;
        room.pausedAt = null;
        changed(room);
      }
    } else if (action.type === "player.remove") {
      const target = room.players.find(({ id }) => id === action.playerId);
      if (!target) return reject(view(), "invalid_target", "No such player");
      if (room.phase === "lobby") {
        room.players = room.players.filter(({ id }) => id !== action.playerId);
        room.lineup = liarsDefaultLineup(room.mode, Math.max(1, room.players.length));
      } else if (target.alive) {
        // Someone actually leaving, not dropping. Removing a player can end the game outright.
        kill(room, target, "left");
        note(room, "day", narrate(room, "left", { victim: target.name }));
        checkWinner(room, now);
      }
      changed(room);
    } else if (action.type === "game.replay" || action.type === "game.lobby") {
      for (const player of room.players) {
        player.previousRole = player.role ?? undefined;
        player.alive = true;
        player.role = null;
      }
      room.gameNumber += 1;
      room.round = 0;
      room.history = [];
      room.dawn = null;
      room.winner = null;
      room.recentNarrationIds = [];
      room.expiresAt = Math.max(room.expiresAt, multiplayerRoomExpiresAt(now));
      room.lineup = room.toggles.firstGame
        ? liarsFirstGameLineup(room.mode, room.players.length)
        : liarsDefaultLineup(room.mode, room.players.length);
      room.lineupCustom = false;
      if (action.type === "game.replay") dealGame(room, now);
      else {
        for (const player of room.players) setMultiplayerPlayerReady(player, false);
        room.phase = "lobby";
        changed(room);
      }
    } else if (action.type === "game.end") {
      finish(room, room.winner ?? "town", now);
    } else {
      return reject(view(), "action_unavailable", "That action is not available now", true);
    }

    room.processedActions = rememberMultiplayerAction(room.processedActions, action.actionId);
    return accept(snapshot(room, input.playerId, now));
  });
  return result ?? failure("room_unavailable", "Room unavailable");
}

export async function applyLiarsPlayerAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action: LiarsPlayerAction;
}): Promise<LiarsActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = room.players.find(({ id }) => id === input.playerId);
    if (!player || !safeEqual(input.playerToken, player.tokenHash))
      return failure("room_unavailable", "Room unavailable");
    const now = Date.now();
    const idleFor = touch(room, player.id, now);
    advance(room, now, idleFor);
    const view = () => snapshot(room, player.id, now);
    if (multiplayerActionSeen(room.processedActions, input.action.actionId)) return accept(view());

    const action = input.action;
    const remembered = () => {
      room.processedActions = rememberMultiplayerAction(room.processedActions, action.actionId);
      return accept(snapshot(room, player.id, now));
    };

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
        now - room.hostDisconnectedSince < LIARS_HOST_CLAIM_AFTER_MS
      )
        return reject(view(), "action_unavailable", "The host is still here");
      if (!player.alive) return reject(view(), "not_alive", "Only a living player can host");
      room.hostPlayerId = player.id;
      room.hostDisconnectedSince = null;
      changed(room);
      return remembered();
    }

    if (action.type === "words.last") {
      if (!player.alive && room.toggles.lastWords && player.lastWords === null) {
        player.lastWords = action.text.slice(0, LIARS_LAST_WORDS_LENGTH).trim();
        if (room.dawn && player.lastWords)
          room.dawn.lastWords.push({ name: player.name, text: player.lastWords });
        changed(room);
        return remembered();
      }
      return reject(view(), "action_unavailable", "Last words have closed");
    }

    if (action.type === "lineup.wish") {
      // Lobby only. Once the game is dealt the lineup is settled and a tally would just be noise.
      if (room.phase !== "lobby") return remembered();
      const has = player.roleWishes.includes(action.role);
      if (has === action.wanted) return remembered();
      player.roleWishes = action.wanted
        ? [...player.roleWishes, action.role]
        : player.roleWishes.filter((role) => role !== action.role);
      changed(room);
      return remembered();
    }

    if (action.type === "graveyard.pin") {
      // The dead only. The living pinning to the dead's board would be a leak in the useful
      // direction, which is the direction that ends games.
      if (player.alive) return remembered();
      const text = action.text.slice(0, LIARS_GRAVEYARD_NOTE_LENGTH).trim();
      if (!text) return remembered();
      // The action id, not the sequence: two pins inside one tick share a sequence, and a board
      // with two identically-keyed notes unpins the wrong one.
      room.graveyardBoard.push({ id: action.actionId, name: player.name, text });
      // Oldest falls off rather than the pin being refused: a full board that silently swallows
      // your note is worse than one that visibly costs you the note you cared about least.
      while (room.graveyardBoard.length > LIARS_GRAVEYARD_BOARD_MAX) room.graveyardBoard.shift();
      changed(room);
      return remembered();
    }

    if (action.type === "graveyard.unpin") {
      if (player.alive) return remembered();
      room.graveyardBoard = room.graveyardBoard.filter(({ id }) => id !== action.noteId);
      changed(room);
      return remembered();
    }

    if (action.type === "graveyard.vote") {
      if (player.alive) return reject(view(), "action_unavailable", "The living do not vote here");
      player.graveyardVote = action.targetId;
      changed(room);
      return remembered();
    }

    if (action.type === "guess.final") {
      if (
        room.phase !== "finalGuess" ||
        player.alive ||
        liarsRoleSide(player.role ?? "villager") !== "mafia"
      )
        return reject(view(), "action_unavailable", "That is not yours to answer");
      resolveFinalGuess(room, now, action.text);
      return remembered();
    }

    if (!player.alive) return reject(view(), "not_alive", "You are dead");

    if (action.type === "night.select" || action.type === "night.lock") {
      if (room.phase !== "night") return reject(view(), "phase_ended", "The night has ended");
      if (action.round !== room.round) return reject(view(), "phase_ended", "That night has ended");
      if (player.nightLocked) return reject(view(), "already_locked", "You have locked in");
      if (action.type === "night.lock") {
        player.nightLocked = true;
        changed(room);
        // An early full lock jumps to the report, never past it.
        if (living(room).every(({ nightLocked }) => nightLocked) && room.reportAt !== null) {
          const remaining = room.phaseEndsAt - room.reportAt;
          room.reportAt = now;
          room.phaseEndsAt = now + remaining;
          writeNightReports(room);
        }
        return remembered();
      }
      const targetable = liarsTargetableIds({
        mode: room.mode,
        role: player.role ?? "villager",
        actorId: player.id,
        living: living(room).map(({ id, role }) => ({ playerId: id, role: role ?? "villager" })),
        previousTargetId: player.previousNightTarget,
        toggles: room.toggles,
      });
      if (action.targetId !== null && !targetable.includes(action.targetId))
        return reject(view(), "invalid_target", "You cannot choose them");
      player.nightTarget = action.targetId;
      changed(room);
      return remembered();
    }

    if (action.type === "clue.said" || action.type === "clue.skip") {
      if (room.phase !== "clue") return reject(view(), "phase_ended", "The clues have ended");
      // Anyone may move a stalled turn on. Somebody who has put their phone down should not be able
      // to hold up nine other people, and there is nothing to cheat here — the order is public.
      const isTheirs = room.clueOrder[room.clueIndex] === player.id;
      if (action.type === "clue.said" && !isTheirs)
        return reject(view(), "not_your_turn", "It is not your turn");
      player.clueDone = isTheirs || player.clueDone;
      advanceClue(room, now);
      return remembered();
    }

    if (action.type === "clue.allSaid") {
      if (room.phase !== "clue") return reject(view(), "phase_ended", "The clues have ended");
      // Two different people, not one person twice: a double-tap is the same thumb making the same
      // mistake, and skipping somebody's turn is not a thing you want to undo.
      room.clueFinishedBy = [...new Set([...(room.clueFinishedBy ?? []), player.id])];
      if (room.clueFinishedBy.length < 2) {
        changed(room);
        return remembered();
      }
      room.clueIndex = room.clueOrder.length;
      advanceClue(room, now);
      return remembered();
    }

    if (action.type === "day.point") {
      if (room.phase !== "deliberation")
        return reject(view(), "action_unavailable", "Nobody is listening yet");
      player.pointedAt = action.targetId;
      changed(room);
      return remembered();
    }

    if (action.type === "day.readyToVote") {
      if (room.phase !== "deliberation")
        return reject(view(), "action_unavailable", "Nobody is listening yet");
      player.readyToVote = action.ready;
      changed(room);
      const alive = living(room);
      const here = alive.filter((candidate) => connected(candidate, now));
      // A majority of who is actually here — and the timer fires anyway, so this cannot deadlock.
      if (here.length > 0 && here.filter(({ readyToVote }) => readyToVote).length > here.length / 2)
        enterPhase(room, "vote", now);
      return remembered();
    }

    if (action.type === "vote.cast" || action.type === "vote.lock") {
      if (room.phase !== "vote") return reject(view(), "phase_ended", "Voting has closed");
      if (player.voteLocked) return reject(view(), "already_locked", "Your vote is in");
      if (action.type === "vote.lock") {
        player.voteLocked = true;
        changed(room);
        if (living(room).every(({ voteLocked }) => voteLocked)) resolveVote(room, now);
        return remembered();
      }
      if (action.targetId !== null) {
        const target = room.players.find(({ id }) => id === action.targetId);
        if (!target || !target.alive)
          return reject(view(), "invalid_target", "They are already out");
      }
      player.vote = action.targetId;
      changed(room);
      return remembered();
    }

    return reject(view(), "action_unavailable", "That action is not available now", true);
  });
  return result ?? failure("room_unavailable", "Room unavailable");
}

export async function authorizeLiarsSocket(input: {
  roomId: string;
  credential: string;
  playerId?: string;
}) {
  const loaded = await loadRoom(input.roomId);
  return Boolean(loaded && authenticate(loaded.room, input.credential, input.playerId));
}

export async function closeLiarsRoom(roomId: string, hostToken: string) {
  const loaded = await loadRoom(roomId);
  if (!loaded) return { ok: true };
  if (!safeEqual(hostToken, loaded.room.hostHash)) return { ok: false };
  await deleteRoom(loaded.room, loaded.keys);
  log.info("things.liars", "Room closed", { phase: loaded.room.phase });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Development only
// ---------------------------------------------------------------------------

/**
 * The full room record, plus every player's token, so a scenario can be captured and put back
 * exactly as it was. This is a complete bypass of every secrecy rule in the game — it exists so a
 * developer can jump to "night three, doctor already dead, mafia at parity" without playing three
 * rounds to get there — and it is refused outside development.
 */
export interface LiarsRoomExport {
  version: 1;
  capturedAt: number;
  /** JSON, so the capture is a file you can read, diff and check into a fixture folder. */
  room: string;
  seats: Array<{ name: string; playerId: string; playerToken: string }>;
}

function developmentOnly() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Liars room export is not available in production");
}

export async function exportLiarsRoom(
  roomId: string,
  hostToken: string,
  seats: Array<{ name: string; playerId: string; playerToken: string }>,
): Promise<LiarsRoomExport | null> {
  developmentOnly();
  const loaded = await loadRoom(roomId);
  if (!loaded || !safeEqual(hostToken, loaded.room.hostHash)) return null;
  return {
    version: 1,
    capturedAt: Date.now(),
    room: JSON.stringify(loaded.room),
    seats,
  };
}

/**
 * Writes the captured room back under a fresh id, so a scenario can be restored repeatedly without
 * colliding with the room it came from. Timestamps are rebased onto now, or a room captured an hour
 * ago would come back already expired and mid-phase.
 */
export async function importLiarsRoom(snapshot: LiarsRoomExport): Promise<{
  roomId: string;
  seats: LiarsRoomExport["seats"];
} | null> {
  developmentOnly();
  if (snapshot.version !== 1) return null;
  const room = JSON.parse(snapshot.room) as LiarsRoomState;
  const now = Date.now();
  const shift = now - snapshot.capturedAt;

  room.roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  room.expiresAt = multiplayerRoomExpiresAt(now);
  room.phaseStartedAt += shift;
  room.phaseEndsAt += shift;
  room.lastActiveAt = now;
  room.pausedAt = null;
  if (room.nightOpensAt !== null) room.nightOpensAt += shift;
  if (room.reportAt !== null) room.reportAt += shift;
  if (room.dawn) {
    room.dawn.nameLandsAt += shift;
    room.dawn.holdUntil += shift;
    room.dawn.settleAt += shift;
    if (room.dawn.reviveAt !== null) room.dawn.reviveAt += shift;
  }
  for (const player of room.players) player.lastSeenAt = now;
  // Fresh receipts belong to the room they were minted for; the restored copy has its own id.
  room.joinReceiptIds = [];

  await saveRoom(room);
  return { roomId: room.roomId, seats: snapshot.seats };
}

/** The host token cannot be recovered from its hash, so a restore mints a new one. */
export async function reissueLiarsHostToken(roomId: string) {
  developmentOnly();
  const loaded = await loadRoom(roomId);
  if (!loaded) return null;
  const hostToken = token();
  loaded.room.hostHash = hash(hostToken);
  await saveRoom(loaded.room, loaded.keys);
  return hostToken;
}

/**
 * Opens a room already populated and dealt, for the harness and for tests. Development only: it
 * mints every player's token at once, which no real client may ever do.
 */
export async function startLiarsScenario(input: {
  mode: LiarsMode;
  names: string[];
  lineup?: LiarsLineup;
  toggles?: Partial<LiarsToggles>;
  timings?: Partial<LiarsTimings>;
  /** Seat index to role. Must still add up to a lineup the validator accepts. */
  deal?: Record<number, LiarsRole>;
}) {
  developmentOnly();
  const created = await createLiarsRoom({
    mode: input.mode,
    roomMode: "same-room",
    toggles: input.toggles,
    timings: input.timings,
  });
  const seats: Array<{ name: string; playerId: string; playerToken: string }> = [];
  for (const name of input.names) {
    const joined = await joinLiarsRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name,
      joinId: `scenario-${created.roomId}-${name}`,
    });
    if (joined.ok) seats.push({ name, playerId: joined.playerId, playerToken: joined.playerToken });
  }

  const result = await withRoom(created.roomId, (room) => {
    if (input.lineup) {
      const check = liarsValidateLineup(room.mode, input.lineup, room.players.length);
      if (!check.ok) return { error: check.problem.message };
      room.lineup = input.lineup;
    }
    const forced = input.deal
      ? Object.fromEntries(
          Object.entries(input.deal).flatMap(([index, role]) => {
            const player = room.players[Number(index)];
            return player ? [[player.id, role]] : [];
          }),
        )
      : undefined;
    if (forced && Object.keys(forced).length !== room.players.length)
      return { error: "the scenario deals a different number of roles than there are seats" };
    dealGame(room, Date.now(), forced);
    return { error: null };
  });

  if (!result || result.error)
    return {
      error: result?.error ?? "room unavailable",
      seats: [],
      roomId: created.roomId,
      hostToken: created.hostToken,
    };
  return { error: null, roomId: created.roomId, hostToken: created.hostToken, seats };
}
