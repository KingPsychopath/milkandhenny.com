import { getRedis } from "@/lib/platform/redis.server";
import {
  multiplayerFailure,
  multiplayerLobbyExpiresAt,
  multiplayerRoomExpiry,
  type MultiplayerRoomPhaseKind,
} from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import { touchMultiplayerPresence } from "../shared/room-presence";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerActionSeen,
  multiplayerCredentialsMatch,
  multiplayerRoomStateChanged,
  multiplayerSnapshotDigest,
  registerMemoryRoomSweeper,
  remainingMultiplayerRoomTtlSeconds,
  rememberMultiplayerAction,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import { hotAndColdRoomRedisKeys } from "./hot-and-cold-keys";
import {
  HOT_AND_COLD_DEFAULT_GUESSES,
  HOT_AND_COLD_DEFAULT_ROUNDS,
  HOT_AND_COLD_DEFAULT_TURN_SECONDS,
  HOT_AND_COLD_GUESS_LIMITS,
  HOT_AND_COLD_JUDGING_VERSION,
  HOT_AND_COLD_PLAYER_LIMITS,
  HOT_AND_COLD_ROUND_LIMITS,
  HOT_AND_COLD_TURN_SECOND_OPTIONS,
  prepareGuess,
  roundWinnerIds,
} from "./hot-and-cold-rules";
import { HotAndColdInvalidGuessError, scoreHotAndColdGuess } from "./hot-and-cold-scorer.server";
import { randomHotAndColdTargets } from "./hot-and-cold-words.server";

import type {
  HotAndColdAction,
  HotAndColdActionResult,
  HotAndColdGuess,
  HotAndColdJoinResult,
  HotAndColdSnapshot,
  HotAndColdSnapshotResult,
} from "./types";

function turnSecondsOption(value: number | undefined): number | undefined {
  return value !== undefined &&
    (HOT_AND_COLD_TURN_SECOND_OPTIONS as readonly number[]).includes(value)
    ? value
    : undefined;
}

const CONNECTED_MS = 25_000;
const HOST_TAKEOVER_MS = 60_000;
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
  sessionScore: number;
  turnsUsed: number;
  gaveUp: boolean;
  withdrawn: boolean;
}
interface RoundState {
  id: string;
  index: number;
  target: string;
  currentPlayerId: string | null;
  turnEndsAt: number | null;
  guesses: HotAndColdGuess[];
  winnerIds: string[];
  exact: boolean;
  openingGuess: boolean;
}
interface RoomState {
  roomId: string;
  managed?: boolean;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: "lobby" | "playing" | "reveal" | "finished" | "closed";
  hostPlayerId: string;
  joinHash: string;
  rounds: number;
  guessesPerPlayer: number;
  turnSeconds: number;
  targets: string[];
  playedTargets: string[];
  players: PlayerState[];
  round: RoundState | null;
  processedActions: string[];
  gameNumber: number;
  judgingVersion: string;
}

const memoryRooms = createMemoryRoomStore<RoomState>("hot-and-cold");

registerMemoryRoomSweeper("hot-and-cold", (now) => {
  for (const [roomId, room] of memoryRooms) if (room.expiresAt <= now) memoryRooms.delete(roomId);
});

const activePlayers = (room: RoomState) => room.players.filter((player) => !player.withdrawn);

function roomRedis() {
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") {
    throw new Error("Hot & Cold rooms require Redis");
  }
  return redis;
}

function phaseKind(room: RoomState): MultiplayerRoomPhaseKind {
  if (room.phase === "lobby") return "lobby";
  if (room.phase === "finished") return "results";
  if (room.phase === "closed") return "closed";
  return "active";
}

function applyRoomExpiry(room: RoomState, now = Date.now()) {
  room.expiresAt = multiplayerRoomExpiry({
    kind: phaseKind(room),
    presentCount: activePlayers(room).length,
    expiresAt: room.expiresAt,
    now,
  });
}

const changed = (room: RoomState) => {
  room.revision += 1;
  room.sequence += 1;
  applyRoomExpiry(room);
};

async function loadRoom(roomId: string) {
  const redis = roomRedis();
  const room = redis
    ? await redis.get<RoomState>(hotAndColdRoomRedisKeys(roomId).state)
    : (memoryRooms.get(roomId) ?? null);
  if (
    !room ||
    room.judgingVersion !== HOT_AND_COLD_JUDGING_VERSION ||
    room.expiresAt <= Date.now()
  ) {
    if (room && !redis) memoryRooms.delete(roomId);
    return null;
  }
  return room;
}
async function saveRoom(room: RoomState) {
  const redis = roomRedis();
  // Presence touches reach here without a revision bump, so the lease renews on save.
  applyRoomExpiry(room);
  if (room.expiresAt <= Date.now()) {
    if (redis) await redis.del(hotAndColdRoomRedisKeys(room.roomId).state);
    else memoryRooms.delete(room.roomId);
    return;
  }
  if (redis)
    await redis.set(hotAndColdRoomRedisKeys(room.roomId).state, room, {
      ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
    });
  else memoryRooms.set(room.roomId, room);
}
async function withRoom<T>(roomId: string, use: (room: RoomState) => T | Promise<T>) {
  const redis = roomRedis();
  if (!redis) {
    const room = await loadRoom(roomId);
    if (!room) return null;
    const before = JSON.stringify(room);
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) await saveRoom(room);
    return result;
  }
  const initial = await loadRoom(roomId);
  if (!initial) return null;
  const keys = hotAndColdRoomRedisKeys(roomId);
  return withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room) return null;
    const before = JSON.stringify(room);
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) await saveRoom(room);
    return result;
  });
}
function validPlayer(room: RoomState, id: string, token: string) {
  const player = room.players.find((candidate) => candidate.id === id);
  return player && !player.withdrawn && multiplayerCredentialsMatch(token, player.tokenHash)
    ? player
    : null;
}
function currentTarget(room: RoomState) {
  return room.round?.target ?? "";
}
function eligible(room: RoomState) {
  return activePlayers(room).filter(
    (player) => !player.gaveUp && player.turnsUsed < room.guessesPerPlayer,
  );
}
function reveal(room: RoomState, exact: boolean) {
  if (!room.round || room.phase !== "playing") return;
  room.round.exact = exact;
  room.round.winnerIds = roundWinnerIds(
    room.round.guesses,
    activePlayers(room)
      .filter((player) => !player.gaveUp)
      .map(({ id }) => id),
  );
  for (const id of room.round.winnerIds) {
    const player = room.players.find((candidate) => candidate.id === id);
    if (player) player.score += 1;
  }
  room.round.currentPlayerId = null;
  room.round.turnEndsAt = null;
  room.phase = "reveal";
  changed(room);
}
function nextTurn(room: RoomState, afterId: string | null, now = Date.now()) {
  const players = activePlayers(room);
  const available = new Set(eligible(room).map(({ id }) => id));
  if (available.size === 0) return reveal(room, false);
  const start = Math.max(0, players.findIndex(({ id }) => id === afterId) + 1);
  for (let offset = 0; offset < players.length; offset += 1) {
    const player = players[(start + offset) % players.length];
    if (!available.has(player.id)) continue;
    if (room.round) {
      room.round.currentPlayerId = player.id;
      room.round.turnEndsAt = room.turnSeconds > 0 ? now + room.turnSeconds * 1_000 : null;
    }
    changed(room);
    return;
  }
  reveal(room, false);
}
function pump(room: RoomState, now = Date.now()) {
  if (room.phase !== "playing" || !room.round?.turnEndsAt || now < room.round.turnEndsAt) return;
  const current = room.players.find(({ id }) => id === room.round?.currentPlayerId);
  if (current) current.turnsUsed += 1;
  nextTurn(room, current?.id ?? null, now);
}
function startRound(room: RoomState, index: number) {
  for (const player of activePlayers(room)) {
    player.turnsUsed = 0;
    player.gaveUp = false;
  }
  room.round = {
    id: crypto.randomUUID(),
    index,
    target: room.targets[index],
    currentPlayerId: null,
    turnEndsAt: null,
    guesses: [],
    winnerIds: [],
    exact: false,
    openingGuess: true,
  };
  room.phase = "playing";
  changed(room);
  const players = activePlayers(room);
  const starterIndex = (room.gameNumber - 1 + index) % players.length;
  nextTurn(room, players[(starterIndex - 1 + players.length) % players.length]?.id ?? null);
}
function snapshot(room: RoomState, playerId: string): HotAndColdSnapshot {
  const now = Date.now();
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  return {
    roomId: room.roomId,
    phase: room.phase,
    revision: room.revision,
    sequence: room.sequence,
    serverNow: now,
    expiresAt: room.expiresAt,
    managed: room.managed,
    gameNumber: room.gameNumber,
    judgingVersion: room.judgingVersion,
    hostPlayerId: room.hostPlayerId,
    canControl: playerId === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS,
    rounds: room.rounds,
    guessesPerPlayer: room.guessesPerPlayer,
    turnSeconds: room.turnSeconds,
    playerId,
    ready: multiplayerPlayerReady(
      room.players.find(({ id }) => id === playerId) ?? { id: playerId },
    ),
    startRequestId: room.players.find(({ id }) => id === playerId)?.startRequestId ?? null,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: now - player.lastSeenAt <= CONNECTED_MS,
      ready: multiplayerPlayerReady(player),
      host: player.id === room.hostPlayerId,
      score: player.score,
      sessionScore: player.sessionScore + player.score,
      turnsUsed: player.turnsUsed,
      gaveUp: player.gaveUp,
      withdrawn: player.withdrawn,
    })),
    round: room.round
      ? {
          id: room.round.id,
          number: room.round.index + 1,
          total: room.rounds,
          currentPlayerId: room.round.currentPlayerId,
          turnEndsAt: room.round.turnEndsAt,
          guesses: room.round.guesses,
          winnerIds: room.round.winnerIds,
          exact: room.round.exact,
          openingGuess: room.round.openingGuess,
          target: room.phase === "reveal" || room.phase === "finished" ? room.round.target : null,
        }
      : null,
    winnerIds:
      room.phase === "finished"
        ? roundWinnerIds(
            room.players.map((player) => ({ playerId: player.id, rank: -player.score })),
            activePlayers(room).map(({ id }) => id),
          )
        : [],
  };
}

export async function createHotAndColdRoom(input: {
  hostName: string;
  rounds?: number;
  guessesPerPlayer?: number;
  turnSeconds?: number;
  managed?: boolean;
}) {
  if (!input.hostName.trim()) throw new Error("Add your name");
  const roomId = await createAvailableMultiplayerRoomId(async (id) => Boolean(await loadRoom(id)));
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const playerId = crypto.randomUUID();
  const now = Date.now();
  const rounds = Math.min(
    HOT_AND_COLD_ROUND_LIMITS.max,
    Math.max(HOT_AND_COLD_ROUND_LIMITS.min, input.rounds ?? HOT_AND_COLD_DEFAULT_ROUNDS),
  );
  const room: RoomState = {
    roomId,
    managed: input.managed,
    expiresAt: multiplayerLobbyExpiresAt(now, 1),
    revision: 1,
    sequence: 1,
    phase: "lobby",
    hostPlayerId: playerId,
    joinHash: hashMultiplayerCredential(joinToken),
    rounds,
    guessesPerPlayer: Math.min(
      HOT_AND_COLD_GUESS_LIMITS.max,
      Math.max(
        HOT_AND_COLD_GUESS_LIMITS.min,
        input.guessesPerPlayer ?? HOT_AND_COLD_DEFAULT_GUESSES,
      ),
    ),
    turnSeconds: turnSecondsOption(input.turnSeconds) ?? HOT_AND_COLD_DEFAULT_TURN_SECONDS,
    targets: randomHotAndColdTargets(rounds),
    playedTargets: [],
    players: [
      {
        id: playerId,
        name: input.hostName.trim(),
        tokenHash: hashMultiplayerCredential(playerToken),
        joinedAt: now,
        lastSeenAt: now,
        ready: true,
        score: 0,
        sessionScore: 0,
        turnsUsed: 0,
        gaveUp: false,
        withdrawn: false,
      },
    ],
    round: null,
    processedActions: [],
    gameNumber: 1,
    judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
  };
  await saveRoom(room);
  return {
    roomId,
    joinToken,
    playerId,
    playerToken,
    expiresAt: room.expiresAt,
    snapshot: snapshot(room, playerId),
  };
}
export async function joinHotAndColdRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
}): Promise<HotAndColdJoinResult> {
  return (
    (await withRoom(input.roomId, (room) => {
      if (room.phase !== "lobby")
        return multiplayerFailure("game_started", "This hunt has started");
      if (
        (room.managed && !input.joinToken) ||
        (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
      )
        return multiplayerFailure("invite_expired", "This invite is no longer valid");
      if (activePlayers(room).length >= HOT_AND_COLD_PLAYER_LIMITS.max)
        return multiplayerFailure("room_full", "This room is full");
      const name = input.name.trim();
      if (!name) return multiplayerFailure("invalid_name", "Add your name");
      if (activePlayers(room).some((player) => player.name.toLowerCase() === name.toLowerCase()))
        return multiplayerFailure("name_taken", "That name is already here");
      const token = createMultiplayerCredential();
      const player: PlayerState = {
        id: crypto.randomUUID(),
        name,
        tokenHash: hashMultiplayerCredential(token),
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        ready: true,
        score: 0,
        sessionScore: 0,
        turnsUsed: 0,
        gaveUp: false,
        withdrawn: false,
      };
      room.players.push(player);
      changed(room);
      return {
        ok: true as const,
        roomId: room.roomId,
        expiresAt: room.expiresAt,
        playerId: player.id,
        playerToken: token,
        snapshot: snapshot(room, player.id),
      };
    })) ?? multiplayerFailure("room_unavailable", "That room is no longer available")
  );
}
export async function readHotAndColdSnapshot(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  lastDigest?: string | null;
}): Promise<HotAndColdSnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    touchMultiplayerPresence(player);
    pump(room);
    const view = snapshot(room, player.id);
    view.digest = multiplayerSnapshotDigest(view);
    if (input.lastDigest === view.digest)
      return {
        ok: true as const,
        unchanged: true as const,
        serverNow: view.serverNow,
        snapshot: null,
      };
    return { ok: true as const, snapshot: view };
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      snapshot: null,
    }
  );
}
export async function applyHotAndColdAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action: HotAndColdAction;
}): Promise<HotAndColdActionResult> {
  let scored: {
    roundId: string;
    target: string;
    word: string;
    rank: number;
    band: HotAndColdGuess["band"];
  } | null = null;
  let invalidDictionaryWord = false;
  if (input.action.type === "guess.submit") {
    const word = prepareGuess(input.action.word);
    if (word) {
      const room = await loadRoom(input.roomId);
      if (room?.round && validPlayer(room, input.playerId, input.playerToken))
        try {
          const target = currentTarget(room);
          scored = {
            roundId: room.round.id,
            target,
            ...(await scoreHotAndColdGuess(target, word)),
          };
        } catch (error) {
          invalidDictionaryWord = error instanceof HotAndColdInvalidGuessError;
          scored = null;
        }
    }
  }
  const result = await withRoom(input.roomId, (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    pump(room);
    const current = () => snapshot(room, player.id);
    const accept = () => {
      room.processedActions = rememberMultiplayerAction(
        room.processedActions,
        input.action.actionId,
      );
      return { ok: true as const, accepted: true as const, snapshot: current() };
    };
    const reject = (
      errorCode:
        | "action_unavailable"
        | "players_not_ready"
        | "invalid_guess"
        | "duplicate_guess"
        | "scorer_unavailable",
      error: string,
    ) => ({ ok: true as const, accepted: false as const, errorCode, error, snapshot: current() });
    if (multiplayerActionSeen(room.processedActions, input.action.actionId)) return accept();
    player.lastSeenAt = Date.now();
    const action = input.action;
    if (action.type === "player.leave") {
      const wasCurrent = room.round?.currentPlayerId === player.id;
      player.withdrawn = true;
      if (room.hostPlayerId === player.id) room.hostPlayerId = activePlayers(room)[0]?.id ?? "";
      if (activePlayers(room).length === 0) room.phase = "closed";
      changed(room);
      if (wasCurrent && room.phase === "playing") nextTurn(room, player.id);
      return accept();
    }
    if (action.type === "player.rename") {
      if (room.phase !== "lobby")
        return reject("action_unavailable", "Names only change in the lobby");
      player.name = action.name.trim();
      changed(room);
      return accept();
    }
    if (action.type === "readiness.set") {
      if (room.phase !== "lobby") return reject("action_unavailable", "The hunt has started");
      setMultiplayerPlayerReady(player, action.ready);
      changed(room);
      return accept();
    }
    if (action.type === "guess.submit") {
      if (
        room.phase !== "playing" ||
        room.round?.id !== action.roundId ||
        room.round.currentPlayerId !== player.id
      )
        return reject("action_unavailable", "It is not your turn");
      if (!prepareGuess(action.word)) return reject("invalid_guess", "Type one English word");
      if (!scored)
        return invalidDictionaryWord
          ? reject("invalid_guess", "That word is not in our dictionary")
          : reject("scorer_unavailable", "The word scorer is warming up. Try again.");
      if (scored.roundId !== room.round.id || scored.target !== room.round.target)
        return reject("action_unavailable", "The round moved on. Try your guess again.");
      if (room.round.guesses.some(({ word }) => word === scored?.word))
        return reject("duplicate_guess", "That word is already in the ledger");
      if (!room.round.openingGuess) player.turnsUsed += 1;
      room.round.openingGuess = false;
      room.round.guesses.push({
        id: crypto.randomUUID(),
        sequence: room.round.guesses.length + 1,
        playerId: player.id,
        playerName: player.name,
        word: scored.word,
        rank: scored.rank,
        band: scored.band,
        createdAt: Date.now(),
      });
      changed(room);
      if (scored.rank === 0) reveal(room, true);
      else nextTurn(room, player.id);
      return accept();
    }
    if (
      (action.type === "turn.pass" || action.type === "round.giveUp") &&
      room.phase === "playing" &&
      room.round?.id === action.roundId
    ) {
      if (action.type === "turn.pass") {
        if (room.round.currentPlayerId !== player.id)
          return reject("action_unavailable", "It is not your turn");
        player.turnsUsed += 1;
      } else player.gaveUp = true;
      changed(room);
      if (room.round.currentPlayerId === player.id) nextTurn(room, player.id);
      return accept();
    }
    const canControl =
      player.id === room.hostPlayerId ||
      Date.now() - (room.players.find(({ id }) => id === room.hostPlayerId)?.lastSeenAt ?? 0) >
        HOST_TAKEOVER_MS;
    if (!canControl) return reject("action_unavailable", "The room lead controls the hunt");
    if (action.type === "host.pass") {
      if (!activePlayers(room).some(({ id }) => id === action.playerId))
        return reject("action_unavailable", "That player is not available");
      room.hostPlayerId = action.playerId;
      changed(room);
      return accept();
    }
    if (action.type === "game.configure" && room.phase === "lobby" && !room.managed) {
      if (action.rounds)
        room.rounds = Math.min(
          HOT_AND_COLD_ROUND_LIMITS.max,
          Math.max(HOT_AND_COLD_ROUND_LIMITS.min, action.rounds),
        );
      if (action.guessesPerPlayer)
        room.guessesPerPlayer = Math.min(
          HOT_AND_COLD_GUESS_LIMITS.max,
          Math.max(HOT_AND_COLD_GUESS_LIMITS.min, action.guessesPerPlayer),
        );
      const turnSeconds = turnSecondsOption(action.turnSeconds);
      if (turnSeconds !== undefined) room.turnSeconds = turnSeconds;
      room.targets = randomHotAndColdTargets(room.rounds, room.playedTargets);
      changed(room);
      return accept();
    }
    if (action.type === "game.start" && room.phase === "lobby") {
      if (activePlayers(room).length < 2)
        return reject("action_unavailable", "Two people is the smallest hunt");
      const unready = multiplayerUnreadyPlayers(activePlayers(room));
      if (unready.length) {
        requestMultiplayerReadiness(unready, action.actionId);
        changed(room);
        return reject("players_not_ready", "Some players are not ready");
      }
      startRound(room, 0);
      return accept();
    }
    if (action.type === "round.next" && room.phase === "reveal" && room.round) {
      const next = room.round.index + 1;
      if (next >= room.rounds) {
        room.phase = "finished";
        changed(room);
      } else startRound(room, next);
      return accept();
    }
    if (
      (action.type === "game.replay" || action.type === "game.lobby") &&
      room.phase === "finished"
    ) {
      room.playedTargets.push(...room.targets);
      room.targets = randomHotAndColdTargets(room.rounds, room.playedTargets);
      for (const candidate of activePlayers(room)) {
        candidate.sessionScore += candidate.score;
        candidate.score = 0;
        candidate.turnsUsed = 0;
        candidate.gaveUp = false;
        setMultiplayerPlayerReady(
          candidate,
          action.type === "game.replay" || candidate.id === room.hostPlayerId,
        );
      }
      room.gameNumber += 1;
      room.round = null;
      room.phase = "lobby";
      changed(room);
      if (action.type === "game.replay") startRound(room, 0);
      return accept();
    }
    return reject("action_unavailable", "That action is not available");
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      accepted: false,
      snapshot: null,
    }
  );
}
export async function authorizeHotAndColdSocket(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}) {
  const room = await loadRoom(input.roomId);
  return Boolean(room && validPlayer(room, input.playerId, input.playerToken));
}
