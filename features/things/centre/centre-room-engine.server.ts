import { getRedis } from "@/lib/platform/redis.server";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerActionSeen,
  multiplayerRoomStateChanged,
  multiplayerSnapshotDigest,
  registerMemoryRoomSweeper,
  remainingMultiplayerRoomTtlSeconds,
  rememberMultiplayerAction,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import { touchMultiplayerPresence } from "../shared/room-presence";
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
import {
  deliverOfficialResultsAfterCommit,
  persistRoomWithOfficialResults,
  sealOfficialGameResult,
} from "../shared/official-game-results.server";
import type { OfficialGameResultEnvelope } from "../shared/official-game-results";
import { centreEntrancePoint, generateCentreMaze } from "./centre-generator";
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
  joinedAt: number;
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
  retired: boolean;
  withdrawn?: boolean;
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
  /** The game-night pool owns admission and lobby settings for this room. */
  managed?: boolean;
  officialResultChannelId?: string;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: "lobby" | "arming" | "countdown" | "racing" | "finishing" | "finished" | "closed";
  difficulty: CentreDifficulty;
  delayedRivals: boolean;
  gameNumber: number;
  joinHash: string;
  hostPlayerId: string;
  processedActions: string[];
  players: PlayerState[];
  course: CourseState | null;
}

type Keys = ReturnType<typeof centreRoomRedisKeys>;
const memoryRooms = createMemoryRoomStore<RoomState>("centre");
const memoryReplays = createMemoryRoomStore<CentreReplayPlayer>("centre-replay");

registerMemoryRoomSweeper("centre", (now) => {
  for (const [roomId, room] of memoryRooms) {
    if (room.expiresAt > now) continue;
    memoryRooms.delete(roomId);
    for (const key of memoryReplays.keys())
      if (key.includes(`:room:${roomId}:`)) memoryReplays.delete(key);
  }
});

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

function changed(room: RoomState) {
  room.revision += 1;
  room.sequence += 1;
  applyRoomExpiry(room);
}

function activePlayers(room: RoomState) {
  return room.players.filter((player) => !player.withdrawn);
}

function transferHost(room: RoomState, leavingId: string, now: number) {
  if (room.hostPlayerId !== leavingId) return;
  const remaining = activePlayers(room).filter((player) => player.id !== leavingId);
  const connected = remaining.filter((player) => now - player.lastSeenAt <= CONNECTED_WINDOW_MS);
  const successor = (connected.length > 0 ? connected : remaining).toSorted(
    (left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
  )[0];
  room.hostPlayerId = successor?.id ?? "";
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
  // Presence touches reach here without a revision bump, so the lease renews on save.
  applyRoomExpiry(room);
  if (room.expiresAt <= Date.now()) {
    if (redis) await redis.del(centreRoomRedisKeys(room.roomId).state);
    else memoryRooms.delete(room.roomId);
    return;
  }
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
    const before = JSON.stringify(room);
    const wasFinished = room.phase === "finished";
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) await saveRoom(room);
    const envelope = !wasFinished && room.phase === "finished" ? centreOfficialResult(room) : null;
    if (envelope)
      deliverOfficialResultsAfterCommit([{ key: `memory:${envelope.payloadHash}`, envelope }]);
    return result;
  }
  const initial = await loadRoom(roomId);
  if (!initial) return null;
  const keys: Keys = centreRoomRedisKeys(roomId);
  let queued: Array<{ key: string; envelope: OfficialGameResultEnvelope }> = [];
  const result = await withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const before = JSON.stringify(room);
    const wasFinished = room.phase === "finished";
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) {
      const envelope =
        !wasFinished && room.phase === "finished" ? centreOfficialResult(room) : null;
      queued = await persistRoomWithOfficialResults({
        redis,
        stateKey: keys.state,
        room,
        ttlSeconds: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
        envelopes: envelope ? [envelope] : [],
      });
    }
    return result;
  });
  deliverOfficialResultsAfterCommit(queued);
  return result;
}

function centreOfficialResult(room: RoomState): OfficialGameResultEnvelope | null {
  if (!room.officialResultChannelId || room.phase !== "finished") return null;
  const places = rankings(room);
  return sealOfficialGameResult({
    channelId: room.officialResultChannelId,
    revision: 1,
    result: {
      gameKind: "centre",
      gameInstanceId: room.roomId,
      resultId: `game:${room.gameNumber}`,
      scope: "game",
      players: room.players.map((player) => ({
        playerId: player.id,
        outcome: player.withdrawn
          ? "withdrawn"
          : player.elapsedMs !== null
            ? "completed"
            : "did-not-finish",
        placement: places.get(player.id),
        durationMs: player.elapsedMs ?? undefined,
        won: places.get(player.id) === 1,
      })),
    },
  });
}

function validPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && !player.withdrawn && multiplayerCredentialsMatch(playerToken, player.tokenHash)
    ? player
    : null;
}

function authenticatedPlayer(room: RoomState, playerId: string, playerToken: string) {
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
  const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
  const places = rankings(room);
  const player = room.players.find(({ id }) => id === playerId);
  return {
    roomId: room.roomId,
    managed: room.managed === true,
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
      retired: candidate.retired === true,
      withdrawn: candidate.withdrawn === true,
    })),
    playerId,
    ready: multiplayerPlayerReady(player ?? { id: playerId }),
    startRequestId: player?.startRequestId ?? null,
    course: room.course ? { ...room.course } : null,
  };
}

function startCourse(room: RoomState) {
  const players = activePlayers(room);
  const seed = randomSeed();
  const maze = generateCentreMaze({
    seed,
    difficulty: room.difficulty,
    playerCount: players.length,
  });
  for (const [index, player] of players.entries()) {
    player.entranceIndex = (index + room.gameNumber - 1) % players.length;
    player.armed = false;
    player.finishedAt = null;
    player.elapsedMs = null;
    player.wallHits = 0;
    player.resets = 0;
    player.retired = false;
  }
  room.course = {
    seed,
    difficulty: room.difficulty,
    playerCount: players.length,
    hash: maze.hash,
    startsAt: null,
    firstFinishAt: null,
    endsAt: null,
  };
  room.phase = "arming";
  changed(room);
}

function advance(room: RoomState, now = Date.now()) {
  if (room.phase === "countdown" && room.course?.startsAt && now >= room.course.startsAt) {
    room.phase = "racing";
    changed(room);
  }
  if (room.phase === "finishing" && room.course?.firstFinishAt && room.course.endsAt) {
    const allFinished = activePlayers(room).every(
      ({ elapsedMs, retired }) => elapsedMs !== null || retired,
    );
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
  managed?: boolean;
  officialResultChannelId?: string;
}): Promise<CentreRoomCredentials> {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const playerId = crypto.randomUUID();
  const room: RoomState = {
    roomId,
    managed: input.managed,
    officialResultChannelId: input.officialResultChannelId,
    expiresAt: multiplayerLobbyExpiresAt(Date.now(), 1),
    revision: 1,
    sequence: 1,
    phase: "lobby",
    difficulty: input.difficulty,
    delayedRivals: input.delayedRivals,
    gameNumber: 1,
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: playerId,
    processedActions: [],
    players: [
      {
        id: playerId,
        name: input.hostName,
        tokenHash: hashMultiplayerCredential(playerToken),
        joinedAt: Date.now(),
        colour: 0,
        entranceIndex: null,
        lastSeenAt: Date.now(),
        ready: true,
        armed: false,
        finishedAt: null,
        elapsedMs: null,
        wallHits: 0,
        resets: 0,
        retired: false,
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
    if (
      (room.managed && !input.joinToken) ||
      (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
    )
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    if (activePlayers(room).length >= MAX_PLAYERS)
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (!name) return multiplayerFailure("invalid_name", "Add your name");
    if (activePlayers(room).some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already racing");
    const playerToken = createMultiplayerCredential();
    const player: PlayerState = {
      id: crypto.randomUUID(),
      name,
      tokenHash: hashMultiplayerCredential(playerToken),
      joinedAt: Date.now(),
      colour: room.players.length % 8,
      entranceIndex: null,
      lastSeenAt: Date.now(),
      ready: true,
      armed: false,
      finishedAt: null,
      elapsedMs: null,
      wallHits: 0,
      resets: 0,
      retired: false,
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
    touchMultiplayerPresence(player);
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
    const now = Date.now();
    const authenticated = authenticatedPlayer(room, input.playerId, input.playerToken);
    if (!authenticated) return null;
    const actionId = input.action.actionId ?? crypto.randomUUID();
    const accept = (playerId = authenticated.id) => {
      room.processedActions = rememberMultiplayerAction(room.processedActions, actionId);
      return { ok: true, accepted: true, snapshot: snapshot(room, playerId) } as const;
    };
    if (multiplayerActionSeen(room.processedActions, actionId)) return accept();
    if (input.action.type === "player.leave") {
      if (authenticated.withdrawn) return accept();
      transferHost(room, authenticated.id, now);
      authenticated.withdrawn = true;
      if (activePlayers(room).length === 0) room.phase = "closed";
      changed(room);
      return accept();
    }
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    player.lastSeenAt = now;
    advance(room, now);
    const action = input.action;
    if (action.type === "player.rename") {
      if (room.phase !== "lobby")
        return rejection(room, player.id, "Names only change in the lobby", "action_unavailable");
      if (
        activePlayers(room).some(
          (candidate) =>
            candidate.id !== player.id &&
            candidate.name.toLocaleLowerCase() === action.name.toLocaleLowerCase(),
        )
      )
        return rejection(room, player.id, "That name is already here", "action_unavailable");
      player.name = action.name;
      changed(room);
      return accept(player.id);
    }
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
      return accept(player.id);
    }
    if (action.type === "arming.set") {
      if (room.phase !== "arming")
        return rejection(room, player.id, "The start is no longer waiting", "action_unavailable");
      if (player.armed !== action.armed) {
        player.armed = action.armed;
        changed(room);
      }
      if (activePlayers(room).every(({ armed }) => armed) && room.course) {
        room.course.startsAt = now + COUNTDOWN_MS;
        room.phase = "countdown";
        changed(room);
      }
      return accept(player.id);
    }
    if (action.type === "race.finish") {
      if (
        (room.phase !== "racing" && room.phase !== "finishing") ||
        !room.course?.startsAt ||
        player.entranceIndex === null ||
        player.retired
      )
        return rejection(
          room,
          player.id,
          "The race is not accepting finishes",
          "action_unavailable",
        );
      if (player.elapsedMs !== null) return accept(player.id);
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
      return accept(player.id);
    }
    if (action.type === "race.progress" || action.type === "race.retire") {
      const allowed =
        action.type === "race.progress"
          ? room.phase === "racing" || room.phase === "finishing" || room.phase === "finished"
          : room.phase === "racing" || room.phase === "finishing" || room.phase === "finished";
      if (!allowed || !room.course?.startsAt || player.entranceIndex === null)
        return rejection(room, player.id, "The race is not accepting routes", "action_unavailable");
      if (
        player.elapsedMs !== null ||
        player.retired ||
        (await loadReplay(room, player.id))?.finished
      )
        return accept(player.id);
      const maze = generateCentreMaze({
        seed: room.course.seed,
        difficulty: room.course.difficulty,
        playerCount: room.course.playerCount,
      });
      const validation = validateCentreRouteProgress(maze, player.entranceIndex, action.route);
      if (action.type === "race.retire") {
        const replayRoute =
          action.courseHash === room.course.hash && validation.valid
            ? action.route
            : { segments: [[centreEntrancePoint(maze, player.entranceIndex)]], wallHits: 0 };
        player.retired = true;
        player.wallHits = replayRoute.wallHits;
        player.resets = replayRoute.segments.length - 1;
        await saveReplay(room, {
          playerId: player.id,
          name: player.name,
          colour: player.colour,
          entranceIndex: player.entranceIndex,
          elapsedMs: validation.valid ? validation.elapsedMs : 0,
          place: room.players.length,
          finished: false,
          route: replayRoute,
        });
        if (activePlayers(room).every(({ elapsedMs, retired }) => elapsedMs !== null || retired))
          room.phase = "finished";
        changed(room);
        return accept(player.id);
      }
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
      return accept(player.id);
    }
    const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
    const canControl =
      player.id === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS;
    if (!canControl)
      return rejection(room, player.id, "The host controls the race", "action_unavailable");
    if (action.type === "host.pass") {
      const target = activePlayers(room).find(({ id }) => id === action.playerId);
      if (!target)
        return rejection(room, player.id, "That player is not available", "action_unavailable");
      room.hostPlayerId = target.id;
      changed(room);
      return accept(player.id);
    }
    if (action.type === "game.configure") {
      if (room.managed)
        return rejection(
          room,
          player.id,
          "The game-night settings are fixed",
          "action_unavailable",
        );
      if (room.phase !== "lobby")
        return rejection(room, player.id, "Settings are locked", "action_unavailable");
      if (action.difficulty !== undefined) room.difficulty = action.difficulty;
      if (action.delayedRivals !== undefined) room.delayedRivals = action.delayedRivals;
      changed(room);
      return accept(player.id);
    }
    if (action.type === "game.start" && room.phase === "lobby") {
      const confirmed = new Set(action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(activePlayers(room));
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
      startCourse(room);
      return accept(player.id);
    }
    if (
      (action.type === "game.replay" || action.type === "game.lobby") &&
      room.phase === "finished"
    ) {
      room.gameNumber += 1;
      if (action.type === "game.replay") startCourse(room);
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
          candidate.retired = false;
        }
        changed(room);
      }
      return accept(player.id);
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
