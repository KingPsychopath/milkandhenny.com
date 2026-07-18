import { randomInt } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import {
  createAvailableMultiplayerRoomId,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerRoomExpiresAt,
  remainingMultiplayerRoomTtlSeconds,
} from "../shared/room-primitives.server";
import { multiplayerFailure } from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import { countryById } from "./countries";
import { drawCountryRoomRedisKeys } from "./draw-country-keys";
import { selectRoomCountries } from "./rotation.server";
import { scoreCountryDrawing } from "./scoring";
import type {
  CountryDrawing,
  DrawCountryActionResult,
  DrawCountryJoinResult,
  DrawCountryPlayerCredentials,
  DrawCountrySnapshot,
  DrawCountrySnapshotResult,
} from "./types";

const CONNECTED_WINDOW_MS = 25_000;
const HOST_TAKEOVER_MS = 35_000;
const REVEAL_MS = 8_000;
const MAX_PLAYERS = 16;

interface PlayerState {
  id: string;
  name: string;
  tokenHash: string;
  score: number;
  roundScore: number | null;
  submitted: boolean;
  drawing: CountryDrawing | null;
  lastSeenAt: number;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;
}

interface RoundState {
  id: string;
  index: number;
  startsAt: number;
  endsAt: number;
  revealAt: number | null;
  nextRoundAt: number | null;
}

interface RoomState {
  roomId: string;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: "lobby" | "drawing" | "reveal" | "finished";
  drawSeconds: number;
  countryIds: string[];
  hostHash: string;
  joinHash: string;
  hostPlayerId: string;
  players: PlayerState[];
  round: RoundState | null;
}

type Keys = ReturnType<typeof drawCountryRoomRedisKeys>;
const memoryRooms = new Map<string, RoomState>();

function changed(room: RoomState) {
  room.revision += 1;
  room.sequence += 1;
}

async function loadRoom(roomId: string) {
  const redis = getRedis();
  const room = redis
    ? await redis.get<RoomState>(drawCountryRoomRedisKeys(roomId).state)
    : (memoryRooms.get(roomId) ?? null);
  if (!room || room.expiresAt <= Date.now()) {
    if (room && redis) await redis.del(drawCountryRoomRedisKeys(roomId).state);
    else if (room) memoryRooms.delete(roomId);
    return null;
  }
  return room;
}

async function saveRoom(room: RoomState) {
  const redis = getRedis();
  if (redis)
    await redis.set(drawCountryRoomRedisKeys(room.roomId).state, room, {
      ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
    });
  else memoryRooms.set(room.roomId, room);
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
  const keys: Keys = drawCountryRoomRedisKeys(roomId);
  const owner = createMultiplayerCredential();
  let acquired = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    acquired = Boolean(await redis.set(keys.lock, owner, { nx: true, px: 5_000 }));
    if (acquired) break;
    await new Promise((resolve) => setTimeout(resolve, 20 + randomInt(25)));
  }
  if (!acquired) throw new Error("Room is busy");
  try {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const result = await use(room);
    await saveRoom(room);
    return result;
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      [keys.lock],
      [owner],
    );
  }
}

function currentCountry(room: RoomState) {
  return countryById(room.countryIds[room.round?.index ?? -1] ?? "");
}

function rankPlayers(room: RoomState) {
  const ranked = room.players
    .filter(({ roundScore }) => roundScore !== null)
    .toSorted((a, b) => (b.roundScore ?? 0) - (a.roundScore ?? 0));
  return new Map(ranked.map((player, index) => [player.id, index + 1]));
}

function snapshot(room: RoomState, playerId: string): DrawCountrySnapshot {
  const now = Date.now();
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  const places = rankPlayers(room);
  const country = currentCountry(room);
  return {
    roomId: room.roomId,
    phase: room.phase,
    serverNow: now,
    revision: room.revision,
    sequence: room.sequence,
    hostPlayerId: room.hostPlayerId,
    canControl: playerId === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      roundScore: player.roundScore,
      submitted: player.submitted,
      connected: now - player.lastSeenAt <= CONNECTED_WINDOW_MS,
      ready: multiplayerPlayerReady(player),
      place: places.get(player.id) ?? null,
    })),
    player: {
      ready: multiplayerPlayerReady(
        room.players.find(({ id }) => id === playerId) ?? { id: playerId },
      ),
      startRequestId: room.players.find(({ id }) => id === playerId)?.startRequestId ?? null,
    },
    round:
      room.round && country
        ? {
            id: room.round.id,
            number: room.round.index + 1,
            total: room.countryIds.length,
            countryId: country.id,
            countryName: country.name,
            startsAt: room.round.startsAt,
            endsAt: room.round.endsAt,
            revealAt: room.round.revealAt,
            nextRoundAt: room.round.nextRoundAt,
          }
        : null,
  };
}

function startRound(room: RoomState, index: number, now = Date.now()) {
  for (const player of room.players) {
    player.roundScore = null;
    player.submitted = false;
    player.drawing = null;
  }
  room.round = {
    id: crypto.randomUUID(),
    index,
    startsAt: now + 1_200,
    endsAt: now + 1_200 + room.drawSeconds * 1_000,
    revealAt: null,
    nextRoundAt: null,
  };
  room.phase = "drawing";
  changed(room);
}

function reveal(room: RoomState, now = Date.now()) {
  if (!room.round || room.phase !== "drawing") return;
  const country = currentCountry(room);
  if (!country) return;
  for (const player of room.players) {
    const roundScore = player.drawing ? scoreCountryDrawing(country, player.drawing).score : 0;
    player.roundScore = roundScore;
    player.score += roundScore;
    player.submitted = true;
  }
  room.phase = "reveal";
  room.round.revealAt = now;
  room.round.nextRoundAt = now + REVEAL_MS;
  changed(room);
}

function advance(room: RoomState, now = Date.now()) {
  if (room.phase === "drawing" && room.round) {
    const active = room.players.filter((player) => now - player.lastSeenAt <= CONNECTED_WINDOW_MS);
    if (
      now >= room.round.endsAt ||
      (active.length > 0 && active.every(({ submitted }) => submitted))
    )
      reveal(room, now);
  }
  if (room.phase === "reveal" && room.round?.nextRoundAt && now >= room.round.nextRoundAt) {
    const next = room.round.index + 1;
    if (next >= room.countryIds.length) {
      room.phase = "finished";
      changed(room);
    } else startRound(room, next, now);
  }
}

function validPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && multiplayerCredentialsMatch(playerToken, player.tokenHash) ? player : null;
}

export async function createDrawCountryRoom(input: {
  hostName: string;
  drawSeconds: number;
  roundTotal: number;
  recentCountryIds: string[];
}) {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const hostToken = createMultiplayerCredential();
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const playerId = crypto.randomUUID();
  const expiresAt = multiplayerRoomExpiresAt();
  const room: RoomState = {
    roomId,
    expiresAt,
    revision: 1,
    sequence: 1,
    phase: "lobby",
    drawSeconds: input.drawSeconds,
    countryIds: selectRoomCountries(input.roundTotal, input.recentCountryIds),
    hostHash: hashMultiplayerCredential(hostToken),
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: playerId,
    players: [
      {
        id: playerId,
        name: input.hostName,
        tokenHash: hashMultiplayerCredential(playerToken),
        score: 0,
        roundScore: null,
        submitted: false,
        drawing: null,
        lastSeenAt: Date.now(),
        ready: true,
        startRequestId: null,
        startRequestedAt: null,
      },
    ],
    round: null,
  };
  await saveRoom(room);
  return {
    roomId,
    expiresAt,
    hostToken,
    joinToken,
    playerId,
    playerToken,
    snapshot: snapshot(room, playerId),
  };
}

export async function joinDrawCountryRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
}): Promise<DrawCountryJoinResult> {
  const result = await withRoom(input.roomId, (room) => {
    advance(room);
    if (room.phase !== "lobby") return multiplayerFailure("game_started", "This game has started");
    if (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    if (room.players.length >= MAX_PLAYERS)
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (name.length < 1) return multiplayerFailure("invalid_name", "Add your name");
    if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already playing");
    const playerToken = createMultiplayerCredential();
    const player: PlayerState = {
      id: crypto.randomUUID(),
      name,
      tokenHash: hashMultiplayerCredential(playerToken),
      score: 0,
      roundScore: null,
      submitted: false,
      drawing: null,
      lastSeenAt: Date.now(),
      ready: true,
      startRequestId: null,
      startRequestedAt: null,
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
    } satisfies DrawCountryPlayerCredentials & { ok: true };
  });
  return result ?? multiplayerFailure("room_unavailable", "That room is no longer available");
}

export async function readDrawCountrySnapshot(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}): Promise<DrawCountrySnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    player.lastSeenAt = Date.now();
    advance(room);
    return { ok: true, snapshot: snapshot(room, player.id) } as const;
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      snapshot: null,
    }
  );
}

export async function applyDrawCountryAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action:
    | { type: "game.start"; removePlayerIds?: string[] }
    | { type: "readiness.set"; ready: boolean }
    | { type: "round.next" }
    | { type: "drawing.submit"; roundId: string; drawing: CountryDrawing };
}): Promise<DrawCountryActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    player.lastSeenAt = Date.now();
    advance(room);
    const current = () => snapshot(room, player.id);
    if (input.action.type === "readiness.set") {
      if (room.phase !== "lobby")
        return {
          ok: true,
          accepted: false,
          errorCode: "action_unavailable",
          error: "Readiness can only change in the lobby",
          snapshot: current(),
        } as const;
      if (multiplayerPlayerReady(player) !== input.action.ready) {
        setMultiplayerPlayerReady(player, input.action.ready);
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: current() } as const;
    }
    if (input.action.type === "drawing.submit") {
      if (room.phase !== "drawing" || room.round?.id !== input.action.roundId)
        return {
          ok: true,
          accepted: false,
          error: "That round has ended",
          snapshot: current(),
        } as const;
      if (!player.submitted) {
        player.drawing = input.action.drawing;
        player.submitted = true;
        changed(room);
        advance(room);
      }
      return { ok: true, accepted: true, snapshot: current() } as const;
    }
    const host = room.players.find(({ id }) => id === room.hostPlayerId);
    const canControl =
      player.id === room.hostPlayerId || !host || Date.now() - host.lastSeenAt > HOST_TAKEOVER_MS;
    if (!canControl)
      return {
        ok: true,
        accepted: false,
        error: "The host controls the rounds",
        snapshot: current(),
      } as const;
    if (input.action.type === "game.start" && room.phase === "lobby") {
      const confirmed = new Set(input.action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(room.players);
      const unconfirmed = unready.filter(
        ({ id, startRequestId }) => id === player.id || !confirmed.has(id) || !startRequestId,
      );
      if (unconfirmed.length > 0) {
        if (requestMultiplayerReadiness(unconfirmed, crypto.randomUUID())) changed(room);
        return {
          ok: true,
          accepted: false,
          errorCode: "players_not_ready",
          error: unconfirmed.some(({ id }) => id === player.id)
            ? "Set yourself ready before starting"
            : "Some players are not ready",
          snapshot: current(),
        } as const;
      }
      if (confirmed.size > 0) {
        room.players = room.players.filter(
          (candidate) =>
            multiplayerPlayerReady(candidate) ||
            candidate.id === player.id ||
            !confirmed.has(candidate.id),
        );
        changed(room);
      }
      startRound(room, 0);
      return { ok: true, accepted: true, snapshot: current() } as const;
    }
    if (input.action.type === "round.next" && room.phase === "reveal" && room.round) {
      room.round.nextRoundAt = Date.now();
      advance(room);
      return { ok: true, accepted: true, snapshot: current() } as const;
    }
    return {
      ok: true,
      accepted: false,
      error: "That action is not available",
      snapshot: current(),
    } as const;
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      accepted: false,
      snapshot: null,
    }
  );
}

export async function authorizeDrawCountrySocket(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}) {
  const room = await loadRoom(input.roomId);
  return Boolean(room && validPlayer(room, input.playerId, input.playerToken));
}
