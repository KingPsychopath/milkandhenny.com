import { getRedis } from "@/lib/platform/redis.server";
import {
  createMemoryRoomStore,
  createAvailableMultiplayerRoomId,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerActionSeen,
  multiplayerRoomExpiresAt,
  multiplayerSnapshotDigest,
  remainingMultiplayerRoomTtlSeconds,
  rememberMultiplayerAction,
  withMultiplayerRoomLock,
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
  DrawCountryAction,
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
  joinedAt: number;
  score: number;
  /** Carried across rematches; `score` restarts at zero each game. */
  sessionScore?: number;
  roundScore: number | null;
  submitted: boolean;
  drawing: CountryDrawing | null;
  lastSeenAt: number;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;
  withdrawn?: boolean;
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
  /** The game-night pool owns admission for this room. */
  managed?: boolean;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: "lobby" | "drawing" | "reveal" | "finished" | "closed";
  drawSeconds: number;
  countryIds: string[];
  hostHash: string;
  joinHash: string;
  hostPlayerId: string;
  processedActions: string[];
  players: PlayerState[];
  round: RoundState | null;
  /** 1 for the first game; a rematch on the same room code increments it. */
  gameNumber?: number;
  /** Countries already played on this room code, so rematches draw fresh ones. */
  playedCountryIds?: string[];
}

type Keys = ReturnType<typeof drawCountryRoomRedisKeys>;
const memoryRooms = createMemoryRoomStore<RoomState>("draw-country");

function changed(room: RoomState) {
  room.revision += 1;
  room.sequence += 1;
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
  return withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const result = await use(room);
    await saveRoom(room);
    return result;
  });
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
  const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
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
    managed: room.managed === true,
    gameNumber: room.gameNumber ?? 1,
    roundTotal: room.countryIds.length,
    drawSeconds: room.drawSeconds,
    expiresAt: room.expiresAt,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      // Games already banked plus whatever this one has earned so far.
      sessionScore: (player.sessionScore ?? 0) + player.score,
      roundScore: player.roundScore,
      submitted: player.submitted,
      connected: now - player.lastSeenAt <= CONNECTED_WINDOW_MS,
      ready: multiplayerPlayerReady(player),
      place: places.get(player.id) ?? null,
      withdrawn: player.withdrawn === true,
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
  for (const player of activePlayers(room)) {
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
  for (const player of activePlayers(room)) {
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

/**
 * Banks the finished game onto every player's session total and deals a fresh set of countries,
 * keeping the roster, the room code and the host. Returns false when the atlas has nothing left
 * that this room has not already drawn.
 */
function resetForRematch(room: RoomState, now = Date.now()) {
  const played = [...(room.playedCountryIds ?? []), ...room.countryIds];
  const countryIds = selectRoomCountries(room.countryIds.length, played);
  if (countryIds.length === 0) return false;
  for (const player of activePlayers(room)) {
    player.sessionScore = (player.sessionScore ?? 0) + player.score;
    player.score = 0;
    player.roundScore = null;
    player.submitted = false;
    player.drawing = null;
  }
  room.playedCountryIds = played.slice(-64);
  room.countryIds = countryIds;
  room.gameNumber = (room.gameNumber ?? 1) + 1;
  room.round = null;
  // A room that reached its last round has been alive a while; a rematch needs its own runway.
  room.expiresAt = Math.max(room.expiresAt, multiplayerRoomExpiresAt(now));
  return true;
}

function advance(room: RoomState, now = Date.now()) {
  if (room.phase === "drawing" && room.round) {
    const active = activePlayers(room).filter(
      (player) => now - player.lastSeenAt <= CONNECTED_WINDOW_MS,
    );
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
  return player && !player.withdrawn && multiplayerCredentialsMatch(playerToken, player.tokenHash)
    ? player
    : null;
}

function authenticatedPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && multiplayerCredentialsMatch(playerToken, player.tokenHash) ? player : null;
}

export async function createDrawCountryRoom(input: {
  hostName: string;
  drawSeconds: number;
  roundTotal: number;
  recentCountryIds: string[];
  managed?: boolean;
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
    managed: input.managed,
    expiresAt,
    revision: 1,
    sequence: 1,
    phase: "lobby",
    drawSeconds: input.drawSeconds,
    countryIds: selectRoomCountries(input.roundTotal, input.recentCountryIds),
    hostHash: hashMultiplayerCredential(hostToken),
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: playerId,
    processedActions: [],
    players: [
      {
        id: playerId,
        name: input.hostName,
        tokenHash: hashMultiplayerCredential(playerToken),
        joinedAt: Date.now(),
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
    if (
      (room.managed && !input.joinToken) ||
      (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
    )
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    if (activePlayers(room).length >= MAX_PLAYERS)
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (name.length < 1) return multiplayerFailure("invalid_name", "Add your name");
    if (activePlayers(room).some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already playing");
    const playerToken = createMultiplayerCredential();
    const player: PlayerState = {
      id: crypto.randomUUID(),
      name,
      tokenHash: hashMultiplayerCredential(playerToken),
      joinedAt: Date.now(),
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
  lastSequence: number;
  /** What this viewer already holds. Matching it means the body can be left off entirely. */
  lastDigest?: string | null;
}): Promise<DrawCountrySnapshotResult> {
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

export async function applyDrawCountryAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action: DrawCountryAction;
}): Promise<DrawCountryActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const now = Date.now();
    const authenticated = authenticatedPlayer(room, input.playerId, input.playerToken);
    if (!authenticated) return null;
    const actionId = input.action.actionId ?? crypto.randomUUID();
    const accept = () => {
      room.processedActions = rememberMultiplayerAction(room.processedActions, actionId);
      return { ok: true, accepted: true, snapshot: snapshot(room, authenticated.id) } as const;
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
    player.lastSeenAt = Date.now();
    advance(room);
    const current = () => snapshot(room, player.id);
    if (input.action.type === "player.rename") {
      const nextName = input.action.name;
      if (room.phase !== "lobby")
        return {
          ok: true,
          accepted: false,
          errorCode: "action_unavailable",
          error: "Names only change in the lobby",
          snapshot: current(),
        } as const;
      if (
        activePlayers(room).some(
          (candidate) =>
            candidate.id !== player.id &&
            candidate.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
        )
      )
        return {
          ok: true,
          accepted: false,
          errorCode: "action_unavailable",
          error: "That name is already here",
          snapshot: current(),
        } as const;
      player.name = nextName;
      changed(room);
      return accept();
    }
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
      return accept();
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
      return accept();
    }
    const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
    const canControl =
      player.id === room.hostPlayerId || !host || Date.now() - host.lastSeenAt > HOST_TAKEOVER_MS;
    if (!canControl)
      return {
        ok: true,
        accepted: false,
        error: "The host controls the rounds",
        snapshot: current(),
      } as const;
    if (input.action.type === "host.pass") {
      const targetId = input.action.playerId;
      const target = activePlayers(room).find(({ id }) => id === targetId);
      if (!target)
        return {
          ok: true,
          accepted: false,
          errorCode: "action_unavailable",
          error: "That player is not available",
          snapshot: current(),
        } as const;
      room.hostPlayerId = target.id;
      changed(room);
      return accept();
    }
    if (input.action.type === "game.start" && room.phase === "lobby") {
      const confirmed = new Set(input.action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(activePlayers(room));
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
      return accept();
    }
    if (input.action.type === "round.next" && room.phase === "reveal" && room.round) {
      room.round.nextRoundAt = Date.now();
      advance(room);
      return accept();
    }
    if (
      (input.action.type === "game.replay" || input.action.type === "game.lobby") &&
      room.phase === "finished"
    ) {
      const now = Date.now();
      if (!resetForRematch(room, now))
        return {
          ok: true,
          accepted: false,
          errorCode: "countries_exhausted",
          error: "This room has drawn every country. Start a new room for more.",
          snapshot: current(),
        } as const;
      if (input.action.type === "game.replay") startRound(room, 0, now);
      else {
        // Back to the lobby so people can join or drop; everyone re-readies from there.
        for (const player of activePlayers(room))
          setMultiplayerPlayerReady(player, player.id === room.hostPlayerId);
        room.phase = "lobby";
        changed(room);
      }
      return accept();
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
