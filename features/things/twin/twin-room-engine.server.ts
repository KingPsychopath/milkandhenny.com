import { getRedis } from "@/lib/platform/redis.server";
import {
  applyGameCommand,
  gameRandomInt,
  replaceGameState,
  versionGameCommand,
  type GameContext,
  type VersionedGameCommand,
  type VersionedGameEvent,
} from "../shared/game-engine";
import { liveGameContext } from "../shared/game-workflow-services.server";
import { log } from "@/lib/platform/logger.server";
import {
  multiplayerFailure,
  multiplayerLobbyExpiresAt,
  multiplayerRoomExpiry,
  type MultiplayerJoinAttempt,
  type MultiplayerRoomPhaseKind,
} from "../shared/multiplayer";
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
  multiplayerActionSeen,
  multiplayerRoomStateChanged,
  multiplayerSnapshotDigest,
  registerMemoryRoomSweeper,
  remainingMultiplayerRoomTtlSeconds,
  rememberMultiplayerAction,
  resolveMultiplayerJoinAttempt,
  withMultiplayerRoomLock,
} from "../shared/room-primitives.server";
import { touchMultiplayerPresence } from "../shared/room-presence";
import {
  publishOfficialResultsAfterCommit,
  persistRoomWithOfficialResults,
  sealOfficialGameResult,
} from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
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
  TwinAction,
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
  joinId?: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
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
  withdrawn?: boolean;
}

interface HeatState {
  id: string;
  number: number;
  /** Frozen for the whole heat so settlement never exposes the next pairing as the last result. */
  middle: CardState;
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

export interface TwinGameState {
  roomId: string;
  /** The game-night pool owns admission and lobby settings for this room. */
  managed?: boolean;
  officialResultChannelId?: string;
  expiresAt: number;
  revision: number;
  sequence: number;
  phase: TwinPhase;
  order: TwinOrder;
  handSize: number;
  requestedHandSize: number;
  windowMs: number;
  graceMs: number;
  settleHoldMs: number;
  hostHash: string;
  joinHash: string;
  hostPlayerId: string;
  joinLocked?: boolean;
  processedActions: string[];
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

type RoomState = TwinGameState;

export type TwinGameCommand = VersionedGameCommand<
  "twin",
  TwinAction,
  { playerId: string; playerToken: string }
>;

export type TwinGameEvent =
  | (VersionedGameEvent<"twin", "log.append"> & { readonly entries: TwinLoggedHeat[] })
  | VersionedGameEvent<"twin", "log.clear">;

type Keys = ReturnType<typeof twinRoomRedisKeys>;
const memoryRooms = createMemoryRoomStore<RoomState>("twin");
const memoryLogs = createMemoryRoomStore<TwinLoggedHeat[]>("twin-log");

registerMemoryRoomSweeper("twin", (now) => {
  for (const [roomId, room] of memoryRooms) {
    if (room.expiresAt > now) continue;
    memoryRooms.delete(roomId);
    memoryLogs.delete(roomId);
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
  // Presence touches reach here without a revision bump, so the lease renews on save.
  applyRoomExpiry(room);
  if (room.expiresAt <= Date.now()) {
    if (redis) await redis.del(twinRoomRedisKeys(room.roomId).state);
    else memoryRooms.delete(room.roomId);
    return;
  }
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
    const before = JSON.stringify(room);
    const wasFinished = room.phase === "finished";
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) await saveRoom(room);
    const envelope = !wasFinished && room.phase === "finished" ? twinOfficialResult(room) : null;
    if (envelope)
      publishOfficialResultsAfterCommit([{ key: `memory:${envelope.payloadHash}`, envelope }]);
    return result;
  }
  const initial = await loadRoom(roomId);
  if (!initial) return null;
  const keys: Keys = twinRoomRedisKeys(roomId);
  let queued: Array<{ key: string; envelope: OfficialGameResultEnvelope }> = [];
  const result = await withMultiplayerRoomLock(redis, { roomId, lockKey: keys.lock }, async () => {
    const room = await redis.get<RoomState>(keys.state);
    if (!room || room.expiresAt <= Date.now()) return null;
    const before = JSON.stringify(room);
    const wasFinished = room.phase === "finished";
    const result = await use(room);
    if (multiplayerRoomStateChanged(before, room)) {
      const envelope = !wasFinished && room.phase === "finished" ? twinOfficialResult(room) : null;
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
  publishOfficialResultsAfterCommit(queued);
  return result;
}

function twinOfficialResult(room: RoomState): OfficialGameResultEnvelope | null {
  if (!room.officialResultChannelId || room.phase !== "finished") return null;
  const ranked = rankTwinFinish(playerStats(room));
  return sealOfficialGameResult({
    channelId: room.officialResultChannelId,
    revision: 1,
    result: {
      gameKind: "twin",
      gameInstanceId: room.roomId,
      resultId: `game:${room.gameNumber}`,
      scope: "game",
      players: ranked.map((player, index) => ({
        playerId: player.playerId,
        outcome: room.players.find(({ id }) => id === player.playerId)?.withdrawn
          ? "withdrawn"
          : "completed",
        rawScore: player.connections,
        placement: index + 1,
        durationMs: player.totalElapsedMs,
        won: index === 0,
      })),
    },
  });
}

function dealtCard(room: RoomState, card: CardState): TwinDealtCard | null {
  const definition = twinCardById(room.order, card.cardId);
  return definition
    ? { cardId: card.cardId, symbolIds: definition.symbolIds, seed: card.seed }
    : null;
}

function connectedPlayers(room: RoomState, now: number) {
  return activePlayers(room).filter((player) => now - player.lastSeenAt <= CONNECTED_WINDOW_MS);
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
  const middleState = room.heat?.middle ?? room.middle;
  const middle = middleState && twinCardById(room.order, middleState.cardId);
  const top = player.hand[0] && twinCardById(room.order, player.hand[0].cardId);
  return middle && top ? twinMatch(top, middle) : null;
}

function startHeat(room: RoomState, now: number) {
  if (!room.middle) throw new Error("Twin cannot start a heat without a middle card");
  room.heatCount += 1;
  const revealAt = now + 150;
  room.heat = {
    id: crypto.randomUUID(),
    number: room.heatCount,
    middle: { ...room.middle },
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
  for (const player of activePlayers(room)) {
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

  const entries = activePlayers(room).map((player) => ({
    playerId: player.id,
    elapsedMs: player.heatId === heat.id ? player.landedMs : null,
    misses: player.heatId === heat.id ? player.heatMisses : 0,
  }));
  const outcome = twinHeatOutcome(entries);
  const playedAgainst = heat.middle;
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

  for (const player of activePlayers(room)) {
    const landed = outcome.ranked.includes(player.id);
    if (!landed) player.chain = 0;
    results.push({
      playerId: player.id,
      name: player.name,
      elapsedMs: player.heatId === heat.id ? player.landedMs : null,
      misses: player.heatId === heat.id ? player.heatMisses : 0,
      shed: landed,
      won: player.id === outcome.winnerPlayerId,
      connection: (() => {
        const match = connections.find(({ playerId }) => playerId === player.id);
        return match ? { card: match.card, symbolId: match.symbolId } : null;
      })(),
    });
  }

  // Nobody found it, so every hand turns over. No card leaves play and the pairing changes.
  if (outcome.burned)
    for (const player of activePlayers(room))
      if (player.hand.length > 1) player.hand = [...player.hand.slice(1), player.hand[0]];

  room.middle = nextMiddle;
  heat.results = results;
  heat.winnerPlayerId = outcome.winnerPlayerId;
  heat.burned = outcome.burned;
  heat.nextHeatAt = now + room.settleHoldMs;
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

function resetForRematch(room: RoomState, now: number, seed?: number) {
  const plan = planTwinDeck(activePlayers(room).length, room.requestedHandSize);
  if (!plan) return false;
  applyDeal(room, plan, now, seed);
  room.gameNumber += 1;
  room.heatCount = 0;
  room.nextPlace = 1;
  for (const player of activePlayers(room)) {
    player.chain = 0;
    player.longestChain = 0;
    player.connections = 0;
    player.misses = 0;
    player.totalElapsedMs = 0;
    player.bestElapsedMs = null;
    player.place = null;
  }
  return true;
}

function applyDeal(
  room: RoomState,
  plan: TwinDeckPlan,
  now: number,
  seed = Math.floor(Math.random() * 2 ** 31),
) {
  const deal = dealTwin(plan, activePlayers(room).length, seed);
  room.order = plan.order;
  room.handSize = plan.handSize;
  activePlayers(room).forEach((player, seat) => {
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
  for (const player of activePlayers(room)) {
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
    if (activePlayers(room).some((player) => player.hand.length === 0)) {
      room.phase = "finished";
      changed(room);
    } else startHeat(room, now);
  }

  return logged;
}

function snapshot(room: RoomState, playerId: string): TwinSnapshot {
  const now = Date.now();
  const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
  const viewer = room.players.find(({ id }) => id === playerId);
  const heat = room.heat;
  const settled = Boolean(heat && heat.results.length > 0);
  const stats = playerStats(room);

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
    joinLocked: room.joinLocked === true,
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
      withdrawn: player.withdrawn === true,
    })),
    heat:
      heat && room.middle
        ? {
            id: heat.id,
            number: heat.number,
            middle: dealtCard(room, room.middle) ?? { cardId: "", symbolIds: [], seed: 0 },
            playedMiddle: dealtCard(room, heat.middle) ?? {
              cardId: "",
              symbolIds: [],
              seed: 0,
            },
            revealAt: heat.revealAt,
            deadlineAt: heat.deadlineAt,
            graceEndsAt: heat.graceEndsAt,
            resolvedAt: heat.resolvedAt,
            settleAt: heat.settleAt,
            nextHeatAt: heat.nextHeatAt,
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
  return player && !player.withdrawn && multiplayerCredentialsMatch(playerToken, player.tokenHash)
    ? player
    : null;
}

function authenticatedPlayer(room: RoomState, playerId: string, playerToken: string) {
  const player = room.players.find(({ id }) => id === playerId);
  return player && multiplayerCredentialsMatch(playerToken, player.tokenHash) ? player : null;
}

function newPlayer(name: string, tokenHash: string, now: number): PlayerState {
  return {
    id: crypto.randomUUID(),
    name,
    tokenHash,
    joinedAt: now,
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
  settleHoldMs?: number;
  managed?: boolean;
  officialResultChannelId?: string;
}) {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const hostToken = createMultiplayerCredential();
  const joinToken = createMultiplayerCredential();
  const playerToken = createMultiplayerCredential();
  const now = Date.now();
  const expiresAt = multiplayerLobbyExpiresAt(now, 1);
  const requestedHandSize = input.handSize ?? TWIN_DEFAULT_HAND;
  const plan = planTwinDeck(1, requestedHandSize);
  const host = newPlayer(input.hostName, hashMultiplayerCredential(playerToken), now);

  const room: RoomState = {
    roomId,
    managed: input.managed,
    officialResultChannelId: input.officialResultChannelId,
    expiresAt,
    revision: 1,
    sequence: 1,
    phase: "lobby",
    order: plan?.order ?? 4,
    handSize: plan?.handSize ?? TWIN_DEFAULT_HAND,
    requestedHandSize,
    windowMs: input.windowMs ?? TWIN_TIMING.defaultWindowMs,
    graceMs: input.graceMs ?? TWIN_TIMING.defaultGraceMs,
    settleHoldMs: input.settleHoldMs ?? TWIN_TIMING.settleHoldMs,
    hostHash: hashMultiplayerCredential(hostToken),
    joinHash: hashMultiplayerCredential(joinToken),
    hostPlayerId: host.id,
    processedActions: [],
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
  joinId?: string;
  playerToken?: string;
}): Promise<TwinJoinResult> {
  const result = await withRoom(input.roomId, async (room) => {
    await appendLog(room, advance(room));
    if (
      (room.managed && !input.joinToken) ||
      (input.joinToken && !multiplayerCredentialsMatch(input.joinToken, room.joinHash))
    )
      return multiplayerFailure("invite_expired", "This invite is no longer valid");
    const attempt: MultiplayerJoinAttempt | undefined =
      input.joinId && input.playerToken
        ? { joinId: input.joinId, playerToken: input.playerToken }
        : undefined;
    const joining = resolveMultiplayerJoinAttempt(room.players, attempt);
    if (joining.kind === "conflict")
      return multiplayerFailure("invite_expired", "This join attempt is no longer valid");
    if (joining.kind === "retry")
      return {
        ok: true,
        roomId: room.roomId,
        expiresAt: room.expiresAt,
        playerId: joining.player.id,
        playerToken: joining.playerToken,
        snapshot: snapshot(room, joining.player.id),
      } satisfies TwinPlayerCredentials & { ok: true };
    if (room.phase !== "lobby") return multiplayerFailure("game_started", "This game has started");
    if (room.joinLocked) return multiplayerFailure("room_locked", "This room is locked");
    if (activePlayers(room).length >= twinMaxPlayers())
      return multiplayerFailure("room_full", "This room is full");
    const name = input.name.trim();
    if (name.length < 1) return multiplayerFailure("invalid_name", "Add your name");
    if (activePlayers(room).some((player) => player.name.toLowerCase() === name.toLowerCase()))
      return multiplayerFailure("name_taken", "That name is already playing");

    const playerToken = joining.playerToken;
    const player = newPlayer(name, hashMultiplayerCredential(playerToken), Date.now());
    player.joinId = joining.joinId;
    room.players.push(player);
    // One more player can mean a bigger deck or a shorter hand; the lobby shows it live.
    const plan = planTwinDeck(activePlayers(room).length, room.requestedHandSize);
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
  lastSequence: number;
  lastDigest?: string | null;
}): Promise<TwinSnapshotResult> {
  const result = await withRoom(input.roomId, async (room) => {
    const player = validPlayer(room, input.playerId, input.playerToken);
    if (!player) return null;
    touchMultiplayerPresence(player);
    await appendLog(room, advance(room));
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

export async function applyTwinAction(
  input: {
    roomId: string;
    playerId: string;
    playerToken: string;
    action: TwinAction;
  },
  context: GameContext = liveGameContext(),
): Promise<TwinActionResult> {
  const pick = gameRandomInt(context);
  const command: TwinGameCommand = versionGameCommand({
    game: "twin",
    actionId: input.action.actionId ?? context.newId,
    actor: { playerId: input.playerId, playerToken: input.playerToken },
    action: input.action,
  });
  const pendingEvents: TwinGameEvent[] = [];
  const result = await withRoom(input.roomId, (room) => {
    const transition = applyGameCommand<
      RoomState,
      "twin",
      TwinAction,
      { playerId: string; playerToken: string },
      TwinActionResult | null,
      TwinGameEvent
    >(room, command, context, (room, _command, _context, emit) => {
      const now = context.now;
      const authenticated = authenticatedPlayer(room, input.playerId, input.playerToken);
      if (!authenticated) return null;
      const actionId = input.action.actionId ?? context.newId;
      const emitLog = (entries: TwinLoggedHeat[]) => {
        if (entries.length > 0)
          emit({
            schemaVersion: 1,
            game: "twin",
            type: "log.append",
            actionId,
            occurredAt: now,
            entries,
          });
      };
      const emitLogClear = () =>
        emit({
          schemaVersion: 1,
          game: "twin",
          type: "log.clear",
          actionId,
          occurredAt: now,
        });
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
      player.lastSeenAt = now;
      emitLog(advance(room, now));

      const current = () => snapshot(room, player.id);
      const reject = (
        errorCode: Parameters<typeof rejection>[0],
        error: string,
        retryable = false,
      ) => rejection(errorCode, error, current(), retryable);

      if (input.action.type === "player.rename") {
        const nextName = input.action.name;
        if (room.phase !== "lobby")
          return reject("action_unavailable", "Names only change in the lobby");
        if (
          activePlayers(room).some(
            (candidate) =>
              candidate.id !== player.id &&
              candidate.name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
          )
        )
          return reject("action_unavailable", "That name is already here");
        player.name = nextName;
        changed(room);
        return accept();
      }

      if (input.action.type === "readiness.set") {
        if (room.phase !== "lobby")
          return reject("action_unavailable", "Readiness can only change in the lobby");
        if (multiplayerPlayerReady(player) !== input.action.ready) {
          setMultiplayerPlayerReady(player, input.action.ready);
          changed(room);
        }
        return accept();
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
        emitLog(advance(room, now));
        return accept();
      }

      const host = room.players.find(({ id, withdrawn }) => id === room.hostPlayerId && !withdrawn);
      const canControl =
        player.id === room.hostPlayerId || !host || now - host.lastSeenAt > HOST_TAKEOVER_MS;
      if (!canControl) return reject("not_host", "The host controls the game");

      if (input.action.type === "room.admission.set") {
        if (room.phase !== "lobby")
          return reject("action_unavailable", "The room only locks in the lobby");
        if (room.joinLocked !== input.action.locked) {
          room.joinLocked = input.action.locked;
          changed(room);
        }
        return accept();
      }

      if (input.action.type === "host.pass") {
        const targetId = input.action.playerId;
        const target = activePlayers(room).find(({ id }) => id === targetId);
        if (!target) return reject("action_unavailable", "That player is not available");
        room.hostPlayerId = target.id;
        changed(room);
        return accept();
      }

      if (input.action.type === "game.configure") {
        if (room.managed) return reject("action_unavailable", "The game-night settings are fixed");
        if (room.phase !== "lobby")
          return reject("action_unavailable", "Settings only change in the lobby");
        if (input.action.handSize !== undefined) room.requestedHandSize = input.action.handSize;
        if (input.action.windowMs !== undefined) room.windowMs = input.action.windowMs;
        if (input.action.graceMs !== undefined) room.graceMs = input.action.graceMs;
        const plan = planTwinDeck(activePlayers(room).length, room.requestedHandSize);
        if (!plan) return reject("deck_too_small", "That is too many cards for this many players");
        room.order = plan.order;
        room.handSize = plan.handSize;
        changed(room);
        return accept();
      }

      if (input.action.type === "timing.configure") {
        if (room.managed) return reject("action_unavailable", "The game-night settings are fixed");
        room.settleHoldMs = input.action.settleHoldMs;
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
          if (requestMultiplayerReadiness(unconfirmed, `${context.newId}:readiness`)) changed(room);
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
        const plan = planTwinDeck(activePlayers(room).length, room.requestedHandSize);
        if (!plan) return reject("deck_too_small", "There are too many players for the deck");
        emitLogClear();
        applyDeal(room, plan, now, pick(2 ** 31));
        return accept();
      }

      if (input.action.type === "heat.next" && room.phase === "settle" && room.heat) {
        room.heat.nextHeatAt = now;
        emitLog(advance(room, now));
        return accept();
      }

      if (
        (input.action.type === "game.replay" || input.action.type === "game.lobby") &&
        room.phase === "finished"
      ) {
        emitLogClear();
        if (input.action.type === "game.replay") {
          if (!resetForRematch(room, now, pick(2 ** 31)))
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
        return accept();
      }

      return reject("action_unavailable", "That action is not available");
    });
    if (!transition.ok) return null;
    replaceGameState(room, transition.value.state);
    pendingEvents.push(
      ...transition.value.events.filter(
        (event): event is TwinGameEvent =>
          event.type === "log.append" || event.type === "log.clear",
      ),
    );
    return transition.value.output;
  });
  const room = pendingEvents.length > 0 ? await loadRoom(input.roomId) : null;
  if (room) {
    for (const event of pendingEvents) {
      if (event.type === "log.clear") await clearLog(room);
      else await appendLog(room, event.entries);
    }
  }
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
