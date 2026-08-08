import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { multiplayerFailure } from "../shared/multiplayer";
import {
  multiplayerPlayerReady,
  multiplayerUnreadyPlayers,
  requestMultiplayerReadiness,
  setMultiplayerPlayerReady,
} from "../shared/multiplayer-readiness";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerRoomExpiresAt,
  remainingMultiplayerRoomTtlSeconds,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import {
  dealTwin,
  planTwinDeck,
  TWIN_DEFAULT_HAND,
  twinCardById,
  twinMatch,
  twinMaxPlayers,
  type TwinDeckPlan,
  type TwinOrder,
} from "./twin-deck";
import { twinRoomRedisKeys } from "./twin-keys";
import {
  rankTwinFinish,
  recordTwinElapsed,
  TWIN_TIMING,
  twinAwards,
  twinCooldownMs,
  twinGraceEnd,
  twinHeadline,
  twinHeatOutcome,
  twinHeatShouldClose,
  type TwinPlayerStats,
} from "./twin-rules";
import type {
  TwinActionResult,
  TwinDealtCard,
  TwinHeatResult,
  TwinJoinResult,
  TwinLoggedConnection,
  TwinLoggedHeat,
  TwinLogResult,
  TwinPlayerCredentials,
  TwinPhase,
  TwinSnapshot,
  TwinSnapshotResult,
} from "./types";

const CONNECTED_WINDOW_MS = 25_000;
const HOST_TAKEOVER_MS = 35_000;

/** A card in room state: an id and a layout seed. Symbols are derived from the deck. */
interface CardState {
  cardId: string;
  seed: number;
}

interface PlayerState {
  id: string;
  name: string;
  tokenHash: string;
  /** Index 0 is the top card — the one in play. */
  hand: CardState[];
  lastSeenAt: number;
  ready?: boolean;
  startRequestId?: string | null;
  startRequestedAt?: number | null;

  /** This heat only. Cleared when the next one deals. */
  heatId: string | null;
  landedMs: number | null;
  heatMisses: number;
  cooldownUntil: number | null;

  chain: number;
  longestChain: number;
  connections: number;
  misses: number;
  totalElapsedMs: number;
  bestElapsedMs: number | null;
  /** Finishing position, in the order hands emptied. */
  place: number | null;
}

interface HeatState {
  id: string;
  number: number;
  revealAt: number;
  deadlineAt: number;
  graceEndsAt: number | null;
  resolvedAt: number | null;
  settleAt: number | null;
  nextHeatAt: number | null;
  results: TwinHeatResult[];
  winnerPlayerId: string | null;
  burned: boolean;
}

interface RoomState {
  roomId: string;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: TwinPhase;
  order: TwinOrder;
  handSize: number;
  requestedHandSize: number;
  windowMs: number;
  graceMs: number;
  hostHash: string;
  joinHash: string;
  hostPlayerId: string;
  players: PlayerState[];
  middle: CardState | null;
  heat: HeatState | null;
  gameNumber: number;
  heatCount: number;
  nextPlace: number;
  dealingUntil: number | null;
  /** Layout seeds come from here, so a rematch lays the same cards out differently. */
  seedCounter: number;
}

type Keys = ReturnType<typeof twinRoomRedisKeys>;
const memoryRooms = createMemoryRoomStore<RoomState>("twin");
const memoryLogs = createMemoryRoomStore<TwinLoggedHeat[]>("twin-log");

function changed(room: RoomState) {
  room.revision += 1;
  room.sequence += 1;
}

async function loadRoom(roomId: string) {
  const redis = getRedis();
  const room = redis
    ? await redis.get<RoomState>(twinRoomRedisKeys(roomId).state)
    : (memoryRooms.get(roomId) ?? null);
  if (!room || room.expiresAt <= Date.now()) {
    if (room && redis) await redis.del(twinRoomRedisKeys(roomId).state);
    else if (room) memoryRooms.delete(roomId);
    return null;
  }
  return room;
}

async function saveRoom(room: RoomState) {
  const redis = getRedis();
  if (redis)
    await redis.set(twinRoomRedisKeys(room.roomId).state, room, {
      ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
    });
  else memoryRooms.set(room.roomId, room);
}

/**
 * Appends finished heats to the log key.
 *
 * A read-modify-write, but one per settle rather than one per poll, and always already inside the
 * room lock. The log is never on the hot path — that is the entire point of it having its own key.
 */
async function appendLog(room: RoomState, entries: TwinLoggedHeat[]) {
  if (entries.length === 0) return;
  const redis = getRedis();
  const keys = twinRoomRedisKeys(room.roomId);
  if (!redis) {
    memoryLogs.set(room.roomId, [...(memoryLogs.get(room.roomId) ?? []), ...entries]);
    return;
  }
  const existing = (await redis.get<TwinLoggedHeat[]>(keys.log)) ?? [];
  await redis.set(keys.log, [...existing, ...entries], {
    ex: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
  });
}

async function clearLog(room: RoomState) {
  const redis = getRedis();
  if (redis) await redis.del(twinRoomRedisKeys(room.roomId).log);
  else memoryLogs.delete(room.roomId);
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
  const keys: Keys = twinRoomRedisKeys(roomId);
  return withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const result = await use(room);
    await saveRoom(room);
    return result;
  });
}

function dealtCard(room: RoomState, card: CardState): TwinDealtCard | null {
  const definition = twinCardById(room.order, card.cardId);
  return definition
    ? { cardId: card.cardId, symbolIds: definition.symbolIds, seed: card.seed }
    : null;
}

function connectedPlayers(room: RoomState, now: number) {
  return room.players.filter((player) => now - player.lastSeenAt <= CONNECTED_WINDOW_MS);
}

function playerStats(room: RoomState): TwinPlayerStats[] {
  return room.players.map((player) => ({
    playerId: player.id,
    name: player.name,
    cardsLeft: player.hand.length,
    place: player.place,
    connections: player.connections,
    misses: player.misses,
    longestChain: player.longestChain,
    totalElapsedMs: player.totalElapsedMs,
    bestElapsedMs: player.bestElapsedMs,
  }));
}

/** The symbol the given player is hunting this heat: their top card against the middle card. */
function expectedSymbol(room: RoomState, player: PlayerState) {
  const middle = room.middle && twinCardById(room.order, room.middle.cardId);
  const top = player.hand[0] && twinCardById(room.order, player.hand[0].cardId);
  return middle && top ? twinMatch(top, middle) : null;
}

function startHeat(room: RoomState, now: number) {
  room.heatCount += 1;
  const revealAt = now + 150;
  room.heat = {
    id: crypto.randomUUID(),
    number: room.heatCount,
    revealAt,
    deadlineAt: revealAt + room.windowMs,
    graceEndsAt: null,
    resolvedAt: null,
    settleAt: null,
    nextHeatAt: null,
    results: [],
    winnerPlayerId: null,
    burned: false,
  };
  for (const player of room.players) {
    player.heatId = room.heat.id;
    player.landedMs = null;
    player.heatMisses = 0;
    player.cooldownUntil = null;
  }
  room.phase = "heat";
  room.dealingUntil = null;
  changed(room);
}

/**
 * The payout, a beat after the heat closed.
 *
 * Everyone who landed it sheds their top card; the fastest one's card becomes the new middle. Nobody
 * landing it burns the heat instead: the middle stays and every hand rotates, which is what stops a
 * pairing nobody can solve from repeating forever.
 */
function settleHeat(room: RoomState, now: number): TwinLoggedHeat | null {
  const heat = room.heat;
  if (!heat || heat.results.length > 0) return null;

  const entries = room.players.map((player) => ({
    playerId: player.id,
    elapsedMs: player.heatId === heat.id ? player.landedMs : null,
    misses: player.heatId === heat.id ? player.heatMisses : 0,
  }));
  const outcome = twinHeatOutcome(entries);
  const playedAgainst = room.middle;
  const middle = playedAgainst ? dealtCard(room, playedAgainst) : null;
  const middleCard = playedAgainst ? twinCardById(room.order, playedAgainst.cardId) : null;

  const connections: TwinLoggedConnection[] = [];
  const results: TwinHeatResult[] = [];
  /**
   * The new middle is held aside rather than assigned as we go.
   *
   * The winner is ranked first, so assigning `room.middle` inside this loop would mean every player
   * after them had their symbol computed against the card they are about to play *next* rather than
   * the one they just solved — which is silently wrong, and shows up as the constellation drawing the
   * wrong symbol on every rib.
   */
  let nextMiddle = playedAgainst;

  for (const playerId of outcome.ranked) {
    const player = room.players.find(({ id }) => id === playerId);
    if (!player) continue;
    const shed = player.hand[0];
    const shedCard = shed ? twinCardById(room.order, shed.cardId) : null;
    const symbolId = middleCard && shedCard ? twinMatch(shedCard, middleCard) : null;
    const elapsedMs = player.landedMs ?? 0;

    player.connections += 1;
    player.chain += 1;
    player.longestChain = Math.max(player.longestChain, player.chain);
    player.totalElapsedMs += elapsedMs;
    player.bestElapsedMs =
      player.bestElapsedMs === null ? elapsedMs : Math.min(player.bestElapsedMs, elapsedMs);

    if (shed) {
      player.hand = player.hand.slice(1);
      const card = dealtCard(room, shed);
      if (card && symbolId)
        connections.push({
          playerId: player.id,
          name: player.name,
          card,
          symbolId,
          elapsedMs,
          won: playerId === outcome.winnerPlayerId,
        });
      // The fastest takes the middle; everyone else's card goes to their own pile, out of play.
      if (playerId === outcome.winnerPlayerId) nextMiddle = shed;
    }
    if (player.hand.length === 0 && player.place === null) {
      player.place = room.nextPlace;
      room.nextPlace += 1;
    }
  }

  for (const player of room.players) {
    const landed = outcome.ranked.includes(player.id);
    if (!landed) player.chain = 0;
    results.push({
      playerId: player.id,
      name: player.name,
      elapsedMs: player.heatId === heat.id ? player.landedMs : null,
      misses: player.heatId === heat.id ? player.heatMisses : 0,
      shed: landed,
      won: player.id === outcome.winnerPlayerId,
    });
  }

  // Nobody found it, so every hand turns over. No card leaves play and the pairing changes.
  if (outcome.burned)
    for (const player of room.players)
      if (player.hand.length > 1) player.hand = [...player.hand.slice(1), player.hand[0]];

  room.middle = nextMiddle;
  heat.results = results;
  heat.winnerPlayerId = outcome.winnerPlayerId;
  heat.burned = outcome.burned;
  heat.nextHeatAt = now + TWIN_TIMING.settleHoldMs;
  room.phase = "settle";
  changed(room);

  return middle
    ? {
        number: heat.number,
        middle,
        connections,
        missedBy: results.filter(({ shed }) => !shed).map(({ name }) => name),
        burned: outcome.burned,
      }
    : null;
}

function resetForRematch(room: RoomState, now: number) {
  const plan = planTwinDeck(room.players.length, room.requestedHandSize);
  if (!plan) return false;
  applyDeal(room, plan, now);
  room.gameNumber += 1;
  room.heatCount = 0;
  room.nextPlace = 1;
  for (const player of room.players) {
    player.chain = 0;
    player.longestChain = 0;
    player.connections = 0;
    player.misses = 0;
    player.totalElapsedMs = 0;
    player.bestElapsedMs = null;
    player.place = null;
  }
  // A room that reached the end has been alive a while; a rematch needs its own runway.
  room.expiresAt = Math.max(room.expiresAt, multiplayerRoomExpiresAt(now));
  return true;
}

function applyDeal(room: RoomState, plan: TwinDeckPlan, now: number) {
  const deal = dealTwin(plan, room.players.length, Math.floor(Math.random() * 2 ** 31));
  room.order = plan.order;
  room.handSize = plan.handSize;
  room.players.forEach((player, seat) => {
    player.hand = deal.hands[seat].map((card) => ({
      cardId: card.id,
      seed: (room.seedCounter += 1),
    }));
    player.heatId = null;
    player.landedMs = null;
    player.heatMisses = 0;
    player.cooldownUntil = null;
  });
  room.middle = { cardId: deal.middle.id, seed: (room.seedCounter += 1) };

  /**
   * The deck's guarantee, checked once per deal rather than trusted.
   *
   * It cannot fail — the plane is generated, no card is dealt twice, and a property test walks every
   * pair at every order. But if it ever did, the symptom would be a heat nobody can win, which reads
   * as a broken interface rather than a broken deck, and would be miserable to chase from a bug report.
   * One O(players) check at the only point a bad deal could enter buys a loud failure instead.
   */
  for (const player of room.players) {
    const top = player.hand[0] && twinCardById(room.order, player.hand[0].cardId);
    if (!top || twinMatch(top, deal.middle) === null)
      throw new Error(
        `Twin dealt an unplayable hand at order ${room.order} for ${room.players.length} players`,
      );
  }

  room.heat = null;
  room.phase = "dealing";
  room.dealingUntil = now + TWIN_TIMING.dealingMs;
  changed(room);
}

/**
 * Drives the clock. Called on every read and every action, so a room advances even when nobody is
 * writing to it — the same shape as the other games here.
 *
 * Returns any heats that finished, for the caller to append to the log outside the pure state work.
 */
function advance(room: RoomState, now = Date.now()): TwinLoggedHeat[] {
  const logged: TwinLoggedHeat[] = [];

  if (room.phase === "dealing" && room.dealingUntil !== null && now >= room.dealingUntil)
    startHeat(room, now);

  if (room.phase === "heat" && room.heat) {
    const heat = room.heat;
    if (heat.resolvedAt === null && now >= heat.revealAt) {
      const contenders = connectedPlayers(room, now).filter(
        (player) => player.hand.length > 0,
      ).length;
      const landed = room.players.filter(
        (player) => player.heatId === heat.id && player.landedMs !== null,
      ).length;
      if (
        twinHeatShouldClose(
          { deadlineAt: heat.deadlineAt, graceEndsAt: heat.graceEndsAt, contenders, landed },
          now,
        )
      ) {
        heat.resolvedAt = now;
        heat.settleAt = now + TWIN_TIMING.settleDelayMs;
        changed(room);
      }
    }
    if (heat.settleAt !== null && now >= heat.settleAt) {
      const entry = settleHeat(room, now);
      if (entry) logged.push(entry);
    }
  }

  if (room.phase === "settle" && room.heat?.nextHeatAt && now >= room.heat.nextHeatAt) {
    // Emptying a hand is the win, so the first one ends the game.
    if (room.players.some((player) => player.hand.length === 0)) {
      room.phase = "finished";
      changed(room);
    } else startHeat(room, now);
  }

  return logged;
}

function snapshot(room: RoomState, playerId: string): TwinSnapshot {
  const now = Date.now();
  const host = room.players.find(({ id }) => id === room.hostPlayerId);
  const viewer = room.players.find(({ id }) => id === playerId);
  const heat = room.heat;
  const settled = Boolean(heat && heat.results.length > 0);
  const stats = playerStats(room);

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
    order: room.order,
    handSize: room.handSize,
    windowMs: room.windowMs,
    graceMs: room.graceMs,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      cardsLeft: player.hand.length,
      chain: player.chain,
      longestChain: player.longestChain,
      connections: player.connections,
      misses: player.misses,
      connected: now - player.lastSeenAt <= CONNECTED_WINDOW_MS,
      ready: multiplayerPlayerReady(player),
      host: player.id === room.hostPlayerId,
      place: player.place,
    })),
    heat:
      heat && room.middle
        ? {
            id: heat.id,
            number: heat.number,
            middle: dealtCard(room, room.middle) ?? { cardId: "", symbolIds: [], seed: 0 },
            revealAt: heat.revealAt,
            deadlineAt: heat.deadlineAt,
            graceEndsAt: heat.graceEndsAt,
            resolvedAt: heat.resolvedAt,
            settleAt: heat.settleAt,
            // A bare count while the heat is live. A list of names would say who to watch.
            landedCount: room.players.filter(
              (player) => player.heatId === heat.id && player.landedMs !== null,
            ).length,
            results: settled ? heat.results : [],
            burned: heat.burned,
          }
        : null,
    player: viewer
      ? {
          playerId: viewer.id,
          ready: multiplayerPlayerReady(viewer),
          startRequestId: viewer.startRequestId ?? null,
          top: viewer.hand[0] ? dealtCard(room, viewer.hand[0]) : null,
          rest: viewer.hand
            .slice(1)
            .map((card) => dealtCard(room, card))
            .filter((card): card is TwinDealtCard => card !== null),
          landedMs: viewer.heatId === heat?.id ? viewer.landedMs : null,
          misses: viewer.heatId === heat?.id ? viewer.heatMisses : 0,
          cooldownUntil: viewer.heatId === heat?.id ? viewer.cooldownUntil : null,
          chain: viewer.chain,
        }
      : null,
    ending:
      room.phase === "finished"
        ? {
            winnerPlayerId: rankTwinFinish(stats)[0]?.playerId ?? null,
            headline: twinHeadline(stats),
            awards: twinAwards(
              stats,
              // Only the count is needed for the copy; the heats themselves live in the log key.
              Array.from({ length: room.heatCount }, (_unused, index) => ({
                number: index + 1,
                middle: { cardId: "", symbolIds: [], seed: 0 },
                connections: [],
                missedBy: [],
                burned: false,
              })),
            ),
            heatCount: room.heatCount,
          }
        : null,
  };
}

function validPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && multiplayerCredentialsMatch(playerToken, player.tokenHash) ? player : null;
}

function newPlayer(name: string, tokenHash: string, now: number): PlayerState {
  return {
    id: crypto.randomUUID(),
    name,
    tokenHash,
    hand: [],
    lastSeenAt: now,
    ready: true,
    startRequestId: null,
    startRequestedAt: null,
    heatId: null,
    landedMs: null,
    heatMisses: 0,
    cooldownUntil: null,
    chain: 0,
    longestChain: 0,
    connections: 0,
    misses: 0,
    totalElapsedMs: 0,
    bestElapsedMs: null,
    place: null,
  };
}

export async function createTwinRoom(input: {
  hostName: string;
  handSize?: number;
  windowMs?: number;
  graceMs?: number;
}) {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const hostToken = createMultiplayerCredential();
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const now = Date.now();
  const expiresAt = multiplayerRoomExpiresAt(now);
  const requestedHandSize = input.handSize ?? TWIN_DEFAULT_HAND;
  const plan = planTwinDeck(1, requestedHandSize);
  const host = newPlayer(input.hostName, hashMultiplayerCredential(playerToken), now);

  const room: RoomState = {
    roomId,
    expiresAt,
    revision: 1,
    sequence: 1,
    phase: "lobby",
    order: plan?.order ?? 4,
    handSize: plan?.handSize ?? TWIN_DEFAULT_HAND,
    requestedHandSize,
    windowMs: input.windowMs ?? TWIN_TIMING.defaultWindowMs,
    graceMs: input.graceMs ?? TWIN_TIMING.defaultGraceMs,
    hostHash: hashMultiplayerCredential(hostToken),
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: host.id,
    players: [host],
    middle: null,
    heat: null,
    gameNumber: 1,
    heatCount: 0,
    nextPlace: 1,
    dealingUntil: null,
    seedCounter: Math.floor(Math.random() * 1_000_000),
  };

  if (!getRedis() && process.env.NODE_ENV === "production")
    throw new Error("Twin rooms require Redis");
  await saveRoom(room);
  log.info("things.twin", "Room created", { handSize: room.handSize });
  return {
    roomId,
    expiresAt,
    hostToken,
    joinToken,
    playerId: host.id,
    playerToken,
    snapshot: snapshot(room, host.id),
  };
}

export async function joinTwinRoom(input: {
  roomId: string;
  joinToken?: string;
  name: string;
}): Promise<TwinJoinResult> {
  const result = await withRoom(input.roomId, async (room) => {
    await appendLog(room, advance(room));
    if (room.phase !== "lobby") return multiplayerFailure("game_started", "This game has started");
    if (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    if (room.players.length >= twinMaxPlayers())
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (name.length < 1) return multiplayerFailure("invalid_name", "Add your name");
    if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already playing");

    const playerToken = createMultiplayerCredential();
    const player = newPlayer(name, hashMultiplayerCredential(playerToken), Date.now());
    room.players.push(player);
    // One more player can mean a bigger deck or a shorter hand; the lobby shows it live.
    const plan = planTwinDeck(room.players.length, room.requestedHandSize);
    if (plan) {
      room.order = plan.order;
      room.handSize = plan.handSize;
    }
    changed(room);
    return {
      ok: true,
      roomId: room.roomId,
      expiresAt: room.expiresAt,
      playerId: player.id,
      playerToken,
      snapshot: snapshot(room, player.id),
    } satisfies TwinPlayerCredentials & { ok: true };
  });
  return result ?? multiplayerFailure("room_unavailable", "That room is no longer available");
}

export async function readTwinSnapshot(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}): Promise<TwinSnapshotResult> {
  const result = await withRoom(input.roomId, async (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    player.lastSeenAt = Date.now();
    await appendLog(room, advance(room));
    return { ok: true, snapshot: snapshot(room, player.id) } as const;
  });
  return (
    result ?? {
      ...multiplayerFailure("room_unavailable", "That room is no longer available"),
      snapshot: null,
    }
  );
}

/** Read once, at the end, for the constellation. Never during play. */
export async function readTwinLog(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}): Promise<TwinLogResult> {
  const room = await loadRoom(input.roomId);
  if (!room || !validPlayer(room, input.playerId, input.playerToken))
    return multiplayerFailure("room_unavailable", "That room is no longer available");
  const redis = getRedis();
  const heats = redis
    ? ((await redis.get<TwinLoggedHeat[]>(twinRoomRedisKeys(input.roomId).log)) ?? [])
    : (memoryLogs.get(input.roomId) ?? []);
  return { ok: true, heats };
}

export async function applyTwinAction(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
  action:
    | { type: "readiness.set"; ready: boolean }
    | { type: "answer.tap"; heatId: string; symbolId: string; elapsedMs: number }
    | { type: "game.start"; removePlayerIds?: string[] }
    | { type: "game.configure"; handSize?: number; windowMs?: number; graceMs?: number }
    | { type: "game.replay" }
    | { type: "game.lobby" }
    | { type: "heat.next" };
}): Promise<TwinActionResult> {
  const result = await withRoom(input.roomId, async (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    const now = Date.now();
    player.lastSeenAt = now;
    await appendLog(room, advance(room, now));

    const current = () => snapshot(room, player.id);
    const reject = (errorCode: Parameters<typeof rejection>[0], error: string, retryable = false) =>
      rejection(errorCode, error, current(), retryable);

    if (input.action.type === "readiness.set") {
      if (room.phase !== "lobby")
        return reject("action_unavailable", "Readiness can only change in the lobby");
      if (multiplayerPlayerReady(player) !== input.action.ready) {
        setMultiplayerPlayerReady(player, input.action.ready);
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: current() } as const;
    }

    if (input.action.type === "answer.tap") {
      const heat = room.heat;
      if (!heat || room.phase !== "heat" || heat.id !== input.action.heatId)
        return reject("heat_ended", "That heat has ended");
      // A tap made in time but delivered late still counts, right up to the payout.
      if (heat.settleAt !== null && now >= heat.settleAt)
        return reject("heat_ended", "That heat has ended");
      if (now < heat.revealAt) return reject("heat_ended", "That heat has not started");
      if (player.heatId !== heat.id) return reject("heat_ended", "That heat has ended");
      if (player.landedMs !== null) return reject("already_landed", "You already found it");
      if (player.cooldownUntil !== null && now < player.cooldownUntil)
        return reject("cooling_down", "Still cooling down");
      if (player.hand.length === 0) return reject("action_unavailable", "Your hand is empty");

      const wanted = expectedSymbol(room, player);
      if (wanted === null) return reject("action_unavailable", "There is nothing to match");

      if (input.action.symbolId !== wanted) {
        player.heatMisses += 1;
        player.misses += 1;
        player.cooldownUntil = now + twinCooldownMs(player.heatMisses);
        changed(room);
        return reject("wrong_symbol", "Not that one");
      }

      player.landedMs = recordTwinElapsed({
        claimedMs: input.action.elapsedMs,
        arrivalElapsedMs: now - heat.revealAt,
        windowMs: room.windowMs,
      });
      // First blood starts everyone else's clock.
      if (heat.graceEndsAt === null)
        heat.graceEndsAt = twinGraceEnd(now, heat.deadlineAt, room.graceMs);
      changed(room);
      await appendLog(room, advance(room, now));
      return { ok: true, accepted: true, snapshot: current() } as const;
    }

    const host = room.players.find(({ id }) => id === room.hostPlayerId);
    const canControl =
      player.id === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS;
    if (!canControl) return reject("not_host", "The host controls the game");

    if (input.action.type === "game.configure") {
      if (room.phase !== "lobby")
        return reject("action_unavailable", "Settings only change in the lobby");
      if (input.action.handSize !== undefined) room.requestedHandSize = input.action.handSize;
      if (input.action.windowMs !== undefined) room.windowMs = input.action.windowMs;
      if (input.action.graceMs !== undefined) room.graceMs = input.action.graceMs;
      const plan = planTwinDeck(room.players.length, room.requestedHandSize);
      if (!plan) return reject("deck_too_small", "That is too many cards for this many players");
      room.order = plan.order;
      room.handSize = plan.handSize;
      changed(room);
      return { ok: true, accepted: true, snapshot: current() } as const;
    }

    if (input.action.type === "game.start" && room.phase === "lobby") {
      const confirmed = new Set(input.action.removePlayerIds ?? []);
      const unready = multiplayerUnreadyPlayers(room.players);
      const unconfirmed = unready.filter(
        ({ id, startRequestId }) => id === player.id || !confirmed.has(id) || !startRequestId,
      );
      if (unconfirmed.length > 0) {
        if (requestMultiplayerReadiness(unconfirmed, crypto.randomUUID())) changed(room);
        return reject(
          "players_not_ready",
          unconfirmed.some(({ id }) => id === player.id)
            ? "Set yourself ready before starting"
            : "Some players are not ready",
        );
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
      const plan = planTwinDeck(room.players.length, room.requestedHandSize);
      if (!plan) return reject("deck_too_small", "There are too many players for the deck");
      await clearLog(room);
      applyDeal(room, plan, now);
      return { ok: true, accepted: true, snapshot: current() } as const;
    }

    if (input.action.type === "heat.next" && room.phase === "settle" && room.heat) {
      room.heat.nextHeatAt = now;
      await appendLog(room, advance(room, now));
      return { ok: true, accepted: true, snapshot: current() } as const;
    }

    if (
      (input.action.type === "game.replay" || input.action.type === "game.lobby") &&
      room.phase === "finished"
    ) {
      await clearLog(room);
      if (input.action.type === "game.replay") {
        if (!resetForRematch(room, now))
          return reject("deck_too_small", "There are too many players for the deck");
      } else {
        // Back to the lobby so people can join or drop; everyone re-readies from there.
        for (const roomPlayer of room.players) {
          setMultiplayerPlayerReady(roomPlayer, roomPlayer.id === room.hostPlayerId);
          roomPlayer.hand = [];
          roomPlayer.chain = 0;
          roomPlayer.longestChain = 0;
          roomPlayer.connections = 0;
          roomPlayer.misses = 0;
          roomPlayer.totalElapsedMs = 0;
          roomPlayer.bestElapsedMs = null;
          roomPlayer.place = null;
        }
        room.phase = "lobby";
        room.heat = null;
        room.middle = null;
        room.heatCount = 0;
        room.nextPlace = 1;
        room.gameNumber += 1;
        changed(room);
      }
      return { ok: true, accepted: true, snapshot: current() } as const;
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

function rejection(
  errorCode:
    | "action_unavailable"
    | "players_not_ready"
    | "heat_ended"
    | "wrong_symbol"
    | "cooling_down"
    | "already_landed"
    | "not_host"
    | "deck_too_small",
  error: string,
  current: TwinSnapshot,
  retryable: boolean,
) {
  return { ok: true, accepted: false, errorCode, error, snapshot: current, retryable } as const;
}

export async function authorizeTwinSocket(input: {
  roomId: string;
  playerId: string;
  playerToken: string;
}) {
  const room = await loadRoom(input.roomId);
  return Boolean(room && validPlayer(room, input.playerId, input.playerToken));
}
