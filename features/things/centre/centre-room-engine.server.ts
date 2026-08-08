import { getRedis } from "@/lib/platform/redis.server";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerRoomExpiresAt,
  multiplayerSnapshotDigest,
  remainingMultiplayerRoomTtlSeconds,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import { multiplayerFailure } from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import { generateCentreMaze } from "./centre-generator";
import { centreRoomRedisKeys } from "./centre-keys";
import { validateCentreRoute, validateCentreRouteProgress } from "./centre-trace";
import type {
  CentreAction,
  CentreActionResult,
  CentreDifficulty,
  CentreJoinResult,
  CentrePlayerCredentials,
  CentreReplayPlayer,
  CentreReplayResult,
  CentreRoomCredentials,
  CentreSnapshot,
  CentreSnapshotResult,
} from "./types";

const CONNECTED_WINDOW_MS = 25_000;
const HOST_TAKEOVER_MS = 35_000;
const COUNTDOWN_MS = 4_000;
const FINISH_WINDOW_MS = 8_000;
const PHOTO_FINISH_MS = 1_250;
const LATENCY_ALLOWANCE_MS = 1_200;
const MAX_PLAYERS = 8;

interface PlayerState {
  id: string;
  name: string;
  tokenHash: string;
  colour: number;
  entranceIndex: number | null;
  lastSeenAt: number;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;
  armed: boolean;
  finishedAt: number | null;
  elapsedMs: number | null;
  wallHits: number;
  resets: number;
}

interface CourseState {
  seed: number;
  difficulty: CentreDifficulty;
  playerCount: number;
  hash: string;
  startsAt: number | null;
  firstFinishAt: number | null;
  endsAt: number | null;
}

interface RoomState {
  roomId: string;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: "lobby" | "arming" | "countdown" | "racing" | "finishing" | "finished";
  difficulty: CentreDifficulty;
  delayedRivals: boolean;
  gameNumber: number;
  joinHash: string;
  hostPlayerId: string;
  players: PlayerState[];
  course: CourseState | null;
}

type Keys = ReturnType<typeof centreRoomRedisKeys>;
const memoryRooms = createMemoryRoomStore<RoomState>("centre");
const memoryReplays = createMemoryRoomStore<CentreReplayPlayer>("centre-replay");

function changed(room: RoomState) {
  room.revision += 1;
  room.sequence += 1;
}

async function loadRoom(roomId: string) {
  const redis = getRedis();
  const room = redis
    ? await redis.get<RoomState>(centreRoomRedisKeys(roomId).state)
    : (memoryRooms.get(roomId) ?? null);
  if (!room || room.expiresAt <= Date.now()) {
    if (room && redis) await redis.del(centreRoomRedisKeys(roomId).state);
    else if (room) memoryRooms.delete(roomId);
    return null;
  }
  return room;
}

async function saveRoom(room: RoomState) {
  const redis = getRedis();
  if (redis)
    await redis.set(centreRoomRedisKeys(room.roomId).state, room, {
      ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
    });
  else memoryRooms.set(room.roomId, room);
}

async function saveReplay(room: RoomState, replay: CentreReplayPlayer) {
  const key = centreRoomRedisKeys(room.roomId).replay(room.gameNumber, replay.playerId);
  const redis = getRedis();
  if (redis)
    await redis.set(key, replay, { ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt) });
  else memoryReplays.set(key, replay);
}

async function loadReplay(room: RoomState, playerId: string) {
  const key = centreRoomRedisKeys(room.roomId).replay(room.gameNumber, playerId);
  const redis = getRedis();
  return redis
    ? ((await redis.get<CentreReplayPlayer>(key)) ?? null)
    : (memoryReplays.get(key) ?? null);
}

async function withRoom<T>(roomId: string, use: (room: RoomState) => T | Promise<T>) {
  const redis = getRedis();
  if (!redis) {
    const room = await loadRoom(roomId);
    if (!room) return null;
    const result = await use(room);
    await saveRoom(room);
    return result;
  }
  const initial = await loadRoom(roomId);
  if (!initial) return null;
  const keys: Keys = centreRoomRedisKeys(roomId);
  return withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const result = await use(room);
    await saveRoom(room);
    return result;
  });
}

function validPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && multiplayerCredentialsMatch(playerToken, player.tokenHash) ? player : null;
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function rankings(room: RoomState) {
  const finished = room.players
    .filter((player): player is PlayerState & { elapsedMs: number; finishedAt: number } =>
      Boolean(player.elapsedMs !== null && player.finishedAt !== null),
    )
    .toSorted(
      (left, right) =>
        left.elapsedMs - right.elapsedMs ||
        left.finishedAt - right.finishedAt ||
        left.id.localeCompare(right.id),
    );
  return new Map(finished.map((player, index) => [player.id, index + 1]));
}

function snapshot(room: RoomState, playerId: string): CentreSnapshot {
  const now = Date.now();
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  const places = rankings(room);
  const player = room.players.find(({ id }) => id === playerId);
  return {
    roomId: room.roomId,
    phase: room.phase,
    serverNow: now,
    revision: room.revision,
    sequence: room.sequence,
    expiresAt: room.expiresAt,
    gameNumber: room.gameNumber,
    hostPlayerId: room.hostPlayerId,
    canControl: playerId === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS,
    delayedRivals: room.delayedRivals,
    difficulty: room.difficulty,
    players: room.players.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      colour: candidate.colour,
      entranceIndex: candidate.entranceIndex,
      connected: now - candidate.lastSeenAt <= CONNECTED_WINDOW_MS,
      ready: multiplayerPlayerReady(candidate),
      armed: candidate.armed,
      finishedAt: candidate.finishedAt,
      elapsedMs: candidate.elapsedMs,
      place: places.get(candidate.id) ?? null,
      wallHits: candidate.wallHits,
      resets: candidate.resets,
    })),
    playerId,
    ready: multiplayerPlayerReady(player ?? { id: playerId }),
    startRequestId: player?.startRequestId ?? null,
    course: room.course ? { ...room.course } : null,
  };
}

function startCourse(room: RoomState, now = Date.now()) {
  const seed = randomSeed();
  const maze = generateCentreMaze({
    seed,
    difficulty: room.difficulty,
    playerCount: room.players.length,
  });
  for (const [index, player] of room.players.entries()) {
    player.entranceIndex = (index + room.gameNumber - 1) % room.players.length;
    player.armed = false;
    player.finishedAt = null;
    player.elapsedMs = null;
    player.wallHits = 0;
    player.resets = 0;
  }
  room.course = {
    seed,
    difficulty: room.difficulty,
    playerCount: room.players.length,
    hash: maze.hash,
    startsAt: null,
    firstFinishAt: null,
    endsAt: null,
  };
  room.phase = "arming";
  room.expiresAt = Math.max(room.expiresAt, multiplayerRoomExpiresAt(now));
  changed(room);
}

function advance(room: RoomState, now = Date.now()) {
  if (room.phase === "countdown" && room.course?.startsAt && now >= room.course.startsAt) {
    room.phase = "racing";
    changed(room);
  }
  if (room.phase === "finishing" && room.course?.firstFinishAt && room.course.endsAt) {
    const allFinished = room.players.every(({ elapsedMs }) => elapsedMs !== null);
    if (
      now >= room.course.endsAt ||
      (allFinished && now >= room.course.firstFinishAt + PHOTO_FINISH_MS)
    ) {
      room.phase = "finished";
      changed(room);
    }
  }
}

function rejection(
  room: RoomState,
  playerId: string,
  error: string,
  errorCode?: "action_unavailable" | "players_not_ready" | "invalid_route",
) {
  return {
    ok: true,
    accepted: false,
    error,
    errorCode,
    snapshot: snapshot(room, playerId),
  } as const;
}

export async function createCentreRoom(input: {
  hostName: string;
  difficulty: CentreDifficulty;
  delayedRivals: boolean;
}): Promise<CentreRoomCredentials> {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const playerId = crypto.randomUUID();
  const room: RoomState = {
    roomId,
    expiresAt: multiplayerRoomExpiresAt(),
    revision: 1,
    sequence: 1,
    phase: "lobby",
    difficulty: input.difficulty,
    delayedRivals: input.delayedRivals,
    gameNumber: 1,
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: playerId,
    players: [
      {
        id: playerId,
        name: input.hostName,
        tokenHash: hashMultiplayerCredential(playerToken),
        colour: 0,
        entranceIndex: null,
        lastSeenAt: Date.now(),
        ready: true,
        armed: false,
        finishedAt: null,
        elapsedMs: null,
        wallHits: 0,
        resets: 0,
      },
    ],
    course: null,
  };
  if (!getRedis() && process.env.NODE_ENV === "production")
    throw new Error("Centre rooms require Redis");
  await saveRoom(room);
  return {
    roomId,
    expiresAt: room.expiresAt,
    joinToken,
    playerId,
    playerToken,
    snapshot: snapshot(room, playerId),
  };
}

export async function joinCentreRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
}): Promise<CentreJoinResult> {
  const result = await withRoom(input.roomId, (room) => {
    advance(room);
    if (room.phase !== "lobby") return multiplayerFailure("game_started", "This race has started");
    if (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    if (room.players.length >= MAX_PLAYERS)
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (!name) return multiplayerFailure("invalid_name", "Add your name");
    if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already racing");
    const playerToken = createMultiplayerCredential();
    const player: PlayerState = {
      id: crypto.randomUUID(),
      name,
      tokenHash: hashMultiplayerCredential(playerToken),
      colour: room.players.length % 8,
      entranceIndex: null,
      lastSeenAt: Date.now(),
      ready: true,
      armed: false,
      finishedAt: null,
      elapsedMs: null,
      wallHits: 0,
      resets: 0,
    };
    room.players.push(player);
    changed(room);
    return {
      ok: true,
      roomId: room.roomId,
      expiresAt: room.expiresAt,
      playerId: player.id,
      playerToken,
      snapshot: snapshot(room, player.id),
    } satisfies CentrePlayerCredentials & { ok: true };
  });
  return result ?? multiplayerFailure("room_unavailable", "That room is no longer available");
}

export async function readCentreSnapshot(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  lastSequence: number;
  lastDigest?: string | null;
}): Promise<CentreSnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    player.lastSeenAt = Date.now();
    advance(room);
    const view = snapshot(room, player.id);
    view.digest = multiplayerSnapshotDigest(view);
    if (input.lastDigest && input.lastDigest === view.digest)
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

export async function applyCentreAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action: CentreAction;
}): Promise<CentreActionResult> {
  const result = await withRoom(input.roomId, async (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    const now = Date.now();
    player.lastSeenAt = now;
    advance(room, now);
    const action = input.action;
    if (action.type === "readiness.set") {
      if (room.phase !== "lobby")
        return rejection(
          room,
          player.id,
          "Readiness only changes in the lobby",
          "action_unavailable",
        );
      if (multiplayerPlayerReady(player) !== action.ready) {
        setMultiplayerPlayerReady(player, action.ready);
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    if (action.type === "arming.set") {
      if (room.phase !== "arming")
        return rejection(room, player.id, "The start is no longer waiting", "action_unavailable");
      if (player.armed !== action.armed) {
        player.armed = action.armed;
        changed(room);
      }
      if (room.players.every(({ armed }) => armed) && room.course) {
        room.course.startsAt = now + COUNTDOWN_MS;
        room.phase = "countdown";
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    if (action.type === "race.finish") {
      if (
        (room.phase !== "racing" && room.phase !== "finishing") ||
        !room.course?.startsAt ||
        player.entranceIndex === null
      )
        return rejection(
          room,
          player.id,
          "The race is not accepting finishes",
          "action_unavailable",
        );
      if (player.elapsedMs !== null)
        return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
      const maze = generateCentreMaze({
        seed: room.course.seed,
        difficulty: room.course.difficulty,
        playerCount: room.course.playerCount,
      });
      const validation = validateCentreRoute(maze, player.entranceIndex, action.route);
      if (
        action.courseHash !== room.course.hash ||
        !validation.valid ||
        Math.abs(validation.elapsedMs - action.claimedElapsedMs) > 250
      )
        return rejection(room, player.id, "That route could not be verified", "invalid_route");
      const arrivalElapsed = now - room.course.startsAt;
      const elapsedMs = Math.round(
        Math.max(500, validation.elapsedMs, arrivalElapsed - LATENCY_ALLOWANCE_MS),
      );
      player.finishedAt = now;
      player.elapsedMs = elapsedMs;
      player.wallHits = action.route.wallHits;
      player.resets = action.route.segments.length - 1;
      if (room.course.firstFinishAt === null) {
        room.course.firstFinishAt = now;
        room.course.endsAt = now + FINISH_WINDOW_MS;
        room.phase = "finishing";
      }
      changed(room);
      const place = rankings(room).get(player.id) ?? 1;
      await saveReplay(room, {
        playerId: player.id,
        name: player.name,
        colour: player.colour,
        entranceIndex: player.entranceIndex,
        elapsedMs,
        place,
        finished: true,
        route: action.route,
      });
      advance(room, now);
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    if (action.type === "race.retire") {
      if (
        (room.phase !== "finishing" && room.phase !== "finished") ||
        !room.course?.startsAt ||
        player.entranceIndex === null
      )
        return rejection(room, player.id, "The race is not accepting routes", "action_unavailable");
      if (await loadReplay(room, player.id))
        return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
      const maze = generateCentreMaze({
        seed: room.course.seed,
        difficulty: room.course.difficulty,
        playerCount: room.course.playerCount,
      });
      const validation = validateCentreRouteProgress(maze, player.entranceIndex, action.route);
      if (action.courseHash !== room.course.hash || !validation.valid)
        return rejection(room, player.id, "That route could not be verified", "invalid_route");
      await saveReplay(room, {
        playerId: player.id,
        name: player.name,
        colour: player.colour,
        entranceIndex: player.entranceIndex,
        elapsedMs: validation.elapsedMs,
        place: room.players.length,
        finished: false,
        route: action.route,
      });
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    const host = room.players.find(({ id }) => id === room.hostPlayerId);
    const canControl =
      player.id === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS;
    if (!canControl)
      return rejection(room, player.id, "The host controls the race", "action_unavailable");
    if (action.type === "game.configure") {
      if (room.phase !== "lobby")
        return rejection(room, player.id, "Settings are locked", "action_unavailable");
      if (action.difficulty !== undefined) room.difficulty = action.difficulty;
      if (action.delayedRivals !== undefined) room.delayedRivals = action.delayedRivals;
      changed(room);
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    if (action.type === "game.start" && room.phase === "lobby") {
      const confirmed = new Set(action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(room.players);
      const unconfirmed = unready.filter(
        ({ id, startRequestId }) => id === player.id || !confirmed.has(id) || !startRequestId,
      );
      if (unconfirmed.length > 0) {
        if (requestMultiplayerReadiness(unconfirmed, crypto.randomUUID())) changed(room);
        return rejection(room, player.id, "Some players are not ready", "players_not_ready");
      }
      if (confirmed.size > 0)
        room.players = room.players.filter(
          (candidate) =>
            multiplayerPlayerReady(candidate) ||
            candidate.id === player.id ||
            !confirmed.has(candidate.id),
        );
      startCourse(room, now);
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    if (
      (action.type === "game.replay" || action.type === "game.lobby") &&
      room.phase === "finished"
    ) {
      room.gameNumber += 1;
      if (action.type === "game.replay") startCourse(room, now);
      else {
        room.phase = "lobby";
        room.course = null;
        for (const candidate of room.players) {
          setMultiplayerPlayerReady(candidate, candidate.id === room.hostPlayerId);
          candidate.armed = false;
          candidate.entranceIndex = null;
          candidate.finishedAt = null;
          candidate.elapsedMs = null;
          candidate.wallHits = 0;
          candidate.resets = 0;
        }
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: snapshot(room, player.id) } as const;
    }
    return rejection(room, player.id, "That action is not available", "action_unavailable");
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      accepted: false,
      snapshot: null,
    }
  );
}

export async function readCentreReplay(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}): Promise<CentreReplayResult> {
  const room = await loadRoom(input.roomId);
  if (!room || !validPlayer(room, input.playerId, input.playerToken))
    return multiplayerFailure("room_unavailable", "That room is no longer available");
  advance(room);
  if (room.phase !== "finished" || !room.course)
    return multiplayerFailure("not_finished", "The replay is not ready");
  const players = (await Promise.all(room.players.map(({ id }) => loadReplay(room, id))))
    .filter((replay): replay is CentreReplayPlayer => replay !== null)
    .toSorted((left, right) =>
      left.finished === right.finished
        ? left.elapsedMs - right.elapsedMs || left.playerId.localeCompare(right.playerId)
        : left.finished
          ? -1
          : 1,
    )
    .map((replay, index) => ({ ...replay, place: index + 1 }));
  return { ok: true, course: { ...room.course }, players };
}

export async function authorizeCentreSocket(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}) {
  const room = await loadRoom(input.roomId);
  return Boolean(room && validPlayer(room, input.playerId, input.playerToken));
}
