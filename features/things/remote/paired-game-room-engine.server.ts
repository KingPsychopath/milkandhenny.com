import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { pairedGameRoomRedisKeys } from "./remote-keys";
import {
  createMemoryRoomStore,
  createAvailableMultiplayerRoomId,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerCredentialsMatch,
  multiplayerRoomExpired,
  registerMemoryRoomSweeper,
  remainingMultiplayerRoomTtlSeconds,
} from "../shared/room-primitives.server";
import {
  MULTIPLAYER_ROOM_ID_PATTERN,
  multiplayerLobbyExpiresAt,
  multiplayerPresenceLeaseExpiresAt,
  multiplayerFailure,
} from "../shared/multiplayer";
import type {
  RemoteCommand,
  RemoteCommandErrorCode,
  RemoteCommandRequest,
  RemoteCommandResult,
  RemoteGameKind,
  RemoteGameSetup,
  RemoteSyncedSnapshot,
  RemoteJudgeSnapshotResult,
  RemotePlayerSetupResult,
  RemotePlayerSyncResult,
  PairedGameRoomCredentials,
  PairedGameRoomRole,
} from "./types";
import { PAIRED_GAME_PRESENCE_TTL_SECONDS } from "./paired-game-timing";
import {
  publishOfficialResultsAfterCommit,
  persistRoomWithOfficialResults,
  sealOfficialGameResult,
} from "@/features/game-results/outbox.server";

const JUDGE_LEASE_TTL_SECONDS = 30;
const COMMAND_MAX_AGE_MS = 12_000;

interface RoomMeta {
  game: RemoteGameKind;
  creatorRole: PairedGameRoomRole;
  playerHash: string;
  judgeHash: string;
  expiresAt: number;
  officialResultChannelId?: string;
}

interface MemoryRoom {
  meta: RoomMeta;
  setup: RemoteGameSetup;
  snapshot: RemoteSyncedSnapshot | null;
  commands: RemoteCommand[];
  commandSequences: Map<string, number>;
  decidedItems: Set<string>;
  nextSequence: number;
  activePlayerEpoch: string | null;
  activeJudgeEpoch: string | null;
  playerSeenAt: number;
  judgeSeenAt: number;
}

const memoryRooms = createMemoryRoomStore<MemoryRoom>("remote");
const REMOTE_ROOM_RENEWAL_WINDOW_MS = 5 * 60 * 1_000;

registerMemoryRoomSweeper("remote", (now) => {
  for (const [roomId, room] of memoryRooms)
    if (room.meta.expiresAt <= now) memoryRooms.delete(roomId);
});

type RemoteRedisKeys = ReturnType<typeof pairedGameRoomRedisKeys>;

interface RoomContext {
  roomId: string;
  meta: RoomMeta;
  keys: RemoteRedisKeys;
}

function remotePersistentKeys(keys: RemoteRedisKeys) {
  return [
    keys.setup,
    keys.snapshot,
    keys.commands,
    keys.commandIds,
    keys.decidedItems,
    keys.commandSequence,
  ];
}

async function renewPairedGameRoom(context: RoomContext, now = Date.now()) {
  const remaining = context.meta.expiresAt - now;
  if (remaining > REMOTE_ROOM_RENEWAL_WINDOW_MS) return;
  const expiresAt = multiplayerPresenceLeaseExpiresAt(now);
  context.meta.expiresAt = expiresAt;
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(context.roomId);
    if (room) room.meta.expiresAt = expiresAt;
    return;
  }
  const roomTtl = remainingMultiplayerRoomTtlSeconds(expiresAt, now);
  await Promise.all([
    redis.set(context.keys.meta, context.meta, { ex: roomTtl }),
    ...remotePersistentKeys(context.keys).map((key) => redis.expire(key, roomTtl)),
  ]);
}

function logSnapshotTransitions(previous: RemoteSyncedSnapshot | null, next: RemoteSyncedSnapshot) {
  const previousIds = new Set(previous?.results.map(({ id }) => id) ?? []);
  const timedOut = next.results.filter(
    ({ id, decision }) => decision === "timed_out" && !previousIds.has(id),
  ).length;
  if (timedOut > 0)
    log.info("things.paired-game-room", "Words timed out", { game: next.game, count: timedOut });
}

export function pairedGameOfficialResult(input: {
  roomId: string;
  channelId: string;
  snapshot: RemoteSyncedSnapshot;
}) {
  if (input.snapshot.phase !== "results") return null;
  return sealOfficialGameResult({
    channelId: input.channelId,
    revision: input.snapshot.revision,
    result: {
      gameKind: input.snapshot.game,
      gameInstanceId: input.roomId,
      resultId: `round:${input.snapshot.roundId ?? input.snapshot.connectionEpoch}`,
      scope: "round",
      players: [
        {
          playerId: `player:${input.roomId}`,
          outcome: "completed",
          rawScore: input.snapshot.score,
          won: true,
        },
      ],
    },
  });
}

function rejectJudgeCommand(
  meta: RoomMeta,
  command: RemoteCommandRequest,
  errorCode: RemoteCommandErrorCode,
  error: string,
) {
  log.info("things.paired-game-room", "Judge command rejected", {
    game: meta.game,
    commandType: command.type,
    reason: errorCode,
  });
  return multiplayerFailure(errorCode, error);
}

function remoteSetupFailure(
  errorCode: "invite_expired" | "room_unavailable",
  error: string,
): RemotePlayerSetupResult {
  return {
    ...multiplayerFailure(errorCode, error),
    setup: null,
    judgeConnected: false,
    expiresAt: null,
  };
}

function remotePlayerSyncFailure(
  errorCode: "room_unavailable" | "game_mismatch" | "player_conflict",
  error: string,
): RemotePlayerSyncResult {
  return {
    ...multiplayerFailure(errorCode, error, errorCode === "player_conflict"),
    commands: [],
    judgeConnected: false,
  };
}

function remoteJudgeFailure(
  errorCode: "invite_expired" | "room_unavailable",
  error: string,
): RemoteJudgeSnapshotResult {
  return {
    ...multiplayerFailure(errorCode, error),
    snapshot: null,
    playerConnected: false,
    judgeActive: false,
    expiresAt: null,
  };
}

function targetsKnownResult(snapshot: RemoteSyncedSnapshot | null, command: RemoteCommandRequest) {
  return (
    command.type !== "amend" || Boolean(snapshot?.results.some(({ id }) => id === command.resultId))
  );
}

function isRemoteDecisionCommand(command: RemoteCommandRequest) {
  return (
    command.type === "correct" ||
    command.type === "incorrect" ||
    command.type === "pass" ||
    command.type === "skip"
  );
}

function judgeCommandPolicy(
  snapshot: RemoteSyncedSnapshot | null,
  command: RemoteCommandRequest,
  receivedAt: number,
): { errorCode: RemoteCommandErrorCode; error: string } | null {
  if (snapshot?.roundId !== command.roundId)
    return { errorCode: "stale_round", error: "Round changed" };
  if (command.type === "play_again") {
    return snapshot.phase === "results"
      ? null
      : { errorCode: "round_not_complete", error: "Round is not complete" };
  }
  if (command.type !== "amend" && snapshot.itemId !== command.itemId)
    return { errorCode: "stale_item", error: "Card changed" };
  if (!targetsKnownResult(snapshot, command))
    return { errorCode: "stale_result", error: "Result changed" };
  if (!isRemoteDecisionCommand(command)) return null;
  const decisionDeadline = snapshot.decisionGraceEndsAt ?? snapshot.decisionClosesAt;
  if (decisionDeadline && receivedAt > decisionDeadline)
    return { errorCode: "decision_closed", error: "Decision window closed" };
  if (snapshot.transitioning) return { errorCode: "transitioning", error: "Card is changing" };
  return null;
}

function allPairedGameKeys(roomId: string) {
  return Object.values(pairedGameRoomRedisKeys(roomId));
}

async function readRoom(roomId: string): Promise<RoomContext | null> {
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(roomId);
    if (!room || multiplayerRoomExpired(room.meta.expiresAt)) {
      memoryRooms.delete(roomId);
      return null;
    }
    return { roomId, meta: room.meta, keys: pairedGameRoomRedisKeys(roomId) };
  }
  const roomKeys = pairedGameRoomRedisKeys(roomId);
  const meta = await redis.get<RoomMeta>(roomKeys.meta);
  if (!meta) return null;
  if (multiplayerRoomExpired(meta.expiresAt)) {
    await redis.del(...allPairedGameKeys(roomId));
    return null;
  }
  return { roomId, meta, keys: roomKeys };
}

export async function authorizePairedGameSocket(input: {
  roomId: string;
  role: PairedGameRoomRole;
  token: string;
}) {
  if (!MULTIPLAYER_ROOM_ID_PATTERN.test(input.roomId) || !input.token || input.token.length > 100)
    return false;
  const room = await readRoom(input.roomId);
  if (!room) return false;
  return multiplayerCredentialsMatch(
    input.token,
    input.role === "player" ? room.meta.playerHash : room.meta.judgeHash,
    100,
  );
}

export async function createPairedGameRoom(input: {
  creatorRole: PairedGameRoomRole;
  setup: RemoteGameSetup;
  officialResultChannelId?: string;
}): Promise<PairedGameRoomCredentials> {
  const playerToken = createMultiplayerCredential();
  const judgeToken = createMultiplayerCredential();
  const now = Date.now();
  const expiresAt = multiplayerLobbyExpiresAt(now, 1);
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await readRoom(candidate)),
  );
  const meta: RoomMeta = {
    game: input.setup.game,
    creatorRole: input.creatorRole,
    playerHash: hashMultiplayerCredential(playerToken),
    judgeHash: hashMultiplayerCredential(judgeToken),
    expiresAt,
    officialResultChannelId: input.officialResultChannelId,
  };
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") {
    log.error("things.paired-game-room", "Room creation unavailable", {
      reason: "redis_not_configured",
    });
    throw new Error("Remote rooms require Redis");
  }
  if (redis) {
    const roomKeys = pairedGameRoomRedisKeys(roomId);
    await Promise.all([
      redis.set(roomKeys.meta, meta, { ex: remainingMultiplayerRoomTtlSeconds(expiresAt, now) }),
      redis.set(roomKeys.setup, input.setup, {
        ex: remainingMultiplayerRoomTtlSeconds(expiresAt, now),
      }),
    ]);
  } else {
    memoryRooms.set(roomId, {
      meta,
      setup: input.setup,
      snapshot: null,
      commands: [],
      commandSequences: new Map(),
      decidedItems: new Set(),
      nextSequence: 1,
      activePlayerEpoch: null,
      activeJudgeEpoch: null,
      playerSeenAt: input.creatorRole === "player" ? Date.now() : 0,
      judgeSeenAt: input.creatorRole === "judge" ? Date.now() : 0,
    });
  }
  log.info("things.paired-game-room", "Room created", {
    game: input.setup.game,
    creatorRole: input.creatorRole,
    storage: redis ? "redis" : "memory",
  });
  return { roomId, playerToken, judgeToken, creatorRole: input.creatorRole, expiresAt };
}

export async function readPairedGamePlayerSetup(input: {
  roomId: string;
  playerToken: string;
}): Promise<RemotePlayerSetupResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.playerToken, meta.playerHash)) {
    return remoteSetupFailure("invite_expired", "Invite expired");
  }
  const now = Date.now();
  await renewPairedGameRoom(context, now);
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return remoteSetupFailure("room_unavailable", "Room unavailable");
    room.playerSeenAt = now;
    return {
      ok: true,
      setup: room.setup,
      judgeConnected: now - room.judgeSeenAt <= PAIRED_GAME_PRESENCE_TTL_SECONDS * 1000,
      expiresAt: meta.expiresAt,
    };
  }
  const roomKeys = context.keys;
  await redis.set(roomKeys.playerPresence, now, { ex: PAIRED_GAME_PRESENCE_TTL_SECONDS });
  const setup = await redis.get<RemoteGameSetup>(roomKeys.setup);
  if (!setup) return remoteSetupFailure("room_unavailable", "Room unavailable");
  return {
    ok: true,
    setup,
    judgeConnected: (await redis.exists(roomKeys.judgePresence)) === 1,
    expiresAt: meta.expiresAt,
  };
}

export async function syncPairedGamePlayer(input: {
  roomId: string;
  playerToken: string;
  snapshot: RemoteSyncedSnapshot;
  lastCommandSequence: number;
}): Promise<RemotePlayerSyncResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.playerToken, meta.playerHash)) {
    return remotePlayerSyncFailure("room_unavailable", "Room unavailable");
  }
  if (meta.game !== input.snapshot.game) {
    return remotePlayerSyncFailure("game_mismatch", "Game mismatch");
  }
  const now = Date.now();
  await renewPairedGameRoom(context, now);
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return remotePlayerSyncFailure("room_unavailable", "Room unavailable");
    if (
      room.activePlayerEpoch &&
      room.activePlayerEpoch !== input.snapshot.connectionEpoch &&
      now - room.playerSeenAt <= PAIRED_GAME_PRESENCE_TTL_SECONDS * 1000
    ) {
      log.warn("things.paired-game-room", "Player lease rejected", {
        game: meta.game,
        reason: "active_epoch",
      });
      return remotePlayerSyncFailure("player_conflict", "Game is active on another phone");
    }
    room.activePlayerEpoch = input.snapshot.connectionEpoch;
    if (input.lastCommandSequence > 0) {
      room.commands = room.commands.filter(
        (command) => command.sequence > input.lastCommandSequence,
      );
    }
    room.commands = room.commands.filter(
      (command) => now - command.createdAt <= COMMAND_MAX_AGE_MS,
    );
    const previousSnapshot = room.snapshot;
    const shouldStoreSnapshot =
      !room.snapshot ||
      room.snapshot.connectionEpoch !== input.snapshot.connectionEpoch ||
      input.snapshot.revision >= room.snapshot.revision;
    if (shouldStoreSnapshot) {
      logSnapshotTransitions(room.snapshot, input.snapshot);
      room.snapshot = { ...input.snapshot, updatedAt: now };
    }
    room.playerSeenAt = now;
    const officialResultChannelId = meta.officialResultChannelId;
    const shouldPublishOfficial =
      shouldStoreSnapshot &&
      input.snapshot.phase === "results" &&
      officialResultChannelId !== undefined &&
      (!previousSnapshot ||
        previousSnapshot.connectionEpoch !== input.snapshot.connectionEpoch ||
        input.snapshot.revision > previousSnapshot.revision);
    if (shouldPublishOfficial && officialResultChannelId) {
      const envelope = pairedGameOfficialResult({
        roomId: input.roomId,
        channelId: officialResultChannelId,
        snapshot: input.snapshot,
      });
      if (envelope)
        publishOfficialResultsAfterCommit([{ key: `memory:${envelope.payloadHash}`, envelope }]);
    }
    return {
      ok: true,
      commands: room.commands.filter((command) => command.sequence > input.lastCommandSequence),
      judgeConnected: now - room.judgeSeenAt <= PAIRED_GAME_PRESENCE_TTL_SECONDS * 1000,
    };
  }

  const roomKeys = context.keys;
  const roomTtl = remainingMultiplayerRoomTtlSeconds(meta.expiresAt);
  const activePlayerEpoch = await redis.get<string>(roomKeys.playerEpoch);
  if (activePlayerEpoch && activePlayerEpoch !== input.snapshot.connectionEpoch) {
    log.warn("things.paired-game-room", "Player lease rejected", {
      game: meta.game,
      reason: "active_epoch",
    });
    return remotePlayerSyncFailure("player_conflict", "Game is active on another phone");
  }
  if (activePlayerEpoch) {
    await redis.set(roomKeys.playerEpoch, input.snapshot.connectionEpoch, {
      ex: PAIRED_GAME_PRESENCE_TTL_SECONDS,
    });
  } else {
    const claimed = await redis.set(roomKeys.playerEpoch, input.snapshot.connectionEpoch, {
      ex: PAIRED_GAME_PRESENCE_TTL_SECONDS,
      nx: true,
    });
    if (
      !claimed &&
      (await redis.get<string>(roomKeys.playerEpoch)) !== input.snapshot.connectionEpoch
    ) {
      return remotePlayerSyncFailure("player_conflict", "Game is active on another phone");
    }
  }
  // Read-only on purpose. A DEL + RPUSH rewrite here raced the judge's
  // concurrent RPUSH — a command appended between the read and the delete was
  // erased before anyone saw it. The queue is already bounded (LTRIM to 50 on
  // the judge side, room TTL on the key), and reads filter by sequence, so
  // consumed or stale entries simply age out with the room.
  const queuedCommands = await redis.lrange<RemoteCommand>(roomKeys.commands, 0, -1);
  const commands = queuedCommands.filter(
    (command) =>
      command.sequence > input.lastCommandSequence && now - command.createdAt <= COMMAND_MAX_AGE_MS,
  );
  const storedSnapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  const shouldStoreSnapshot =
    !storedSnapshot ||
    storedSnapshot.connectionEpoch !== input.snapshot.connectionEpoch ||
    input.snapshot.revision >= storedSnapshot.revision;
  if (shouldStoreSnapshot) logSnapshotTransitions(storedSnapshot, input.snapshot);
  const stored = { ...input.snapshot, updatedAt: now };
  const official =
    shouldStoreSnapshot && input.snapshot.phase === "results" && meta.officialResultChannelId
      ? pairedGameOfficialResult({
          roomId: input.roomId,
          channelId: meta.officialResultChannelId,
          snapshot: input.snapshot,
        })
      : null;
  const queued = shouldStoreSnapshot
    ? await persistRoomWithOfficialResults({
        redis,
        stateKey: roomKeys.snapshot,
        room: stored,
        ttlSeconds: roomTtl,
        envelopes: official ? [official] : [],
      })
    : [];
  await redis.set(roomKeys.playerPresence, now, { ex: PAIRED_GAME_PRESENCE_TTL_SECONDS });
  publishOfficialResultsAfterCommit(queued);
  return {
    ok: true,
    commands,
    judgeConnected: (await redis.exists(roomKeys.judgePresence)) === 1,
  };
}

export async function readPairedGameJudge(input: {
  roomId: string;
  judgeToken: string;
  judgeEpoch: string;
  takeover: boolean;
}): Promise<RemoteJudgeSnapshotResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.judgeToken, meta.judgeHash)) {
    return remoteJudgeFailure("invite_expired", "Invite expired");
  }
  const now = Date.now();
  await renewPairedGameRoom(context, now);
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return remoteJudgeFailure("room_unavailable", "Room unavailable");
    const leaseExpired = now - room.judgeSeenAt > JUDGE_LEASE_TTL_SECONDS * 1000;
    const judgeActive =
      input.takeover ||
      leaseExpired ||
      !room.activeJudgeEpoch ||
      room.activeJudgeEpoch === input.judgeEpoch;
    if (judgeActive) {
      if (input.takeover && room.activeJudgeEpoch && room.activeJudgeEpoch !== input.judgeEpoch) {
        log.info("things.paired-game-room", "Judge control taken over", {
          game: meta.game,
          storage: "memory",
        });
      }
      room.activeJudgeEpoch = input.judgeEpoch;
      room.judgeSeenAt = now;
    }
    return {
      ok: true,
      snapshot: room.snapshot,
      playerConnected: now - room.playerSeenAt <= PAIRED_GAME_PRESENCE_TTL_SECONDS * 1000,
      judgeActive,
      expiresAt: meta.expiresAt,
    };
  }
  const roomKeys = context.keys;
  const existingJudgeEpoch = await redis.get<string>(roomKeys.judgeEpoch);
  let judgeActive = existingJudgeEpoch === input.judgeEpoch;
  if (input.takeover) {
    judgeActive = true;
    await redis.set(roomKeys.judgeEpoch, input.judgeEpoch, { ex: JUDGE_LEASE_TTL_SECONDS });
    if (existingJudgeEpoch && existingJudgeEpoch !== input.judgeEpoch) {
      log.info("things.paired-game-room", "Judge control taken over", {
        game: meta.game,
        storage: "redis",
      });
    }
  } else if (judgeActive) {
    await redis.set(roomKeys.judgeEpoch, input.judgeEpoch, { ex: JUDGE_LEASE_TTL_SECONDS });
  } else if (!existingJudgeEpoch) {
    judgeActive = Boolean(
      await redis.set(roomKeys.judgeEpoch, input.judgeEpoch, {
        ex: JUDGE_LEASE_TTL_SECONDS,
        nx: true,
      }),
    );
  }
  if (judgeActive)
    await redis.set(roomKeys.judgePresence, now, { ex: PAIRED_GAME_PRESENCE_TTL_SECONDS });
  return {
    ok: true,
    snapshot: await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot),
    playerConnected: (await redis.exists(roomKeys.playerPresence)) === 1,
    judgeActive,
    expiresAt: meta.expiresAt,
  };
}

export async function sendPairedGameJudgeCommand(input: {
  roomId: string;
  judgeToken: string;
  judgeEpoch: string;
  command: RemoteCommandRequest;
}): Promise<RemoteCommandResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.judgeToken, meta.judgeHash))
    return multiplayerFailure("invite_expired", "Invite expired");
  const receivedAt = Date.now();
  const commandAge = receivedAt - input.command.createdAt;
  if (commandAge > COMMAND_MAX_AGE_MS || commandAge < -5_000)
    return multiplayerFailure("command_expired", "Command expired");
  await renewPairedGameRoom(context);
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return multiplayerFailure("room_unavailable", "Room unavailable");
    if (
      room.activeJudgeEpoch !== input.judgeEpoch ||
      receivedAt - room.judgeSeenAt > JUDGE_LEASE_TTL_SECONDS * 1000
    )
      return rejectJudgeCommand(
        meta,
        input.command,
        "inactive_judge",
        "Controls are active on another screen",
      );
    const existingSequence = room.commandSequences.get(input.command.id);
    if (existingSequence !== undefined) return { ok: true, sequence: existingSequence };
    const policyRejection = judgeCommandPolicy(room.snapshot, input.command, receivedAt);
    if (policyRejection)
      return rejectJudgeCommand(
        meta,
        input.command,
        policyRejection.errorCode,
        policyRejection.error,
      );
    const isDecision = isRemoteDecisionCommand(input.command);
    if (isDecision && room.decidedItems.has(input.command.itemId))
      return rejectJudgeCommand(meta, input.command, "already_decided", "Word already decided");
    const queued = { ...input.command, sequence: room.nextSequence++, receivedAt };
    room.commandSequences.set(input.command.id, queued.sequence);
    if (isDecision) room.decidedItems.add(input.command.itemId);
    room.commands.push(queued);
    if (room.commands.length > 50) room.commands.splice(0, room.commands.length - 50);
    return { ok: true, sequence: queued.sequence };
  }
  const roomKeys = context.keys;
  if ((await redis.get<string>(roomKeys.judgeEpoch)) !== input.judgeEpoch)
    return rejectJudgeCommand(
      meta,
      input.command,
      "inactive_judge",
      "Controls are active on another screen",
    );
  const existingSequence = await redis.hget<number>(roomKeys.commandIds, input.command.id);
  if (existingSequence !== null) return { ok: true, sequence: existingSequence };
  const rate = await redis.incr(roomKeys.commandRate);
  if (rate === 1) await redis.expire(roomKeys.commandRate, 60);
  if (rate > 120)
    return rejectJudgeCommand(meta, input.command, "rate_limited", "Too many controls");
  const snapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  const policyRejection = judgeCommandPolicy(snapshot, input.command, receivedAt);
  if (policyRejection)
    return rejectJudgeCommand(
      meta,
      input.command,
      policyRejection.errorCode,
      policyRejection.error,
    );
  const isDecision = isRemoteDecisionCommand(input.command);
  const sequence = await redis.incr(roomKeys.commandSequence);
  const roomTtl = remainingMultiplayerRoomTtlSeconds(meta.expiresAt);
  const claimedSequence = await redis.eval<unknown[], number>(
    "local existing=redis.call('hget',KEYS[1],ARGV[1]); if existing then return tonumber(existing) end; if ARGV[2]~='' and redis.call('hexists',KEYS[2],ARGV[2])==1 then return -1 end; redis.call('hset',KEYS[1],ARGV[1],ARGV[3]); if ARGV[2]~='' then redis.call('hset',KEYS[2],ARGV[2],ARGV[3]) end; return tonumber(ARGV[3])",
    [roomKeys.commandIds, roomKeys.decidedItems],
    [
      input.command.id,
      isDecision ? hashMultiplayerCredential(input.command.itemId) : "",
      String(sequence),
    ],
  );
  if (claimedSequence === -1)
    return rejectJudgeCommand(meta, input.command, "already_decided", "Word already decided");
  if (claimedSequence !== sequence) return { ok: true, sequence: claimedSequence };
  await Promise.all([
    redis.expire(roomKeys.commandIds, roomTtl),
    redis.expire(roomKeys.decidedItems, roomTtl),
  ]);
  await redis.rpush(roomKeys.commands, { ...input.command, sequence, receivedAt });
  await redis.ltrim(roomKeys.commands, -50, -1);
  await redis.expire(roomKeys.commands, roomTtl);
  await redis.expire(roomKeys.commandSequence, roomTtl);
  return { ok: true, sequence };
}

/**
 * Drops whoever is judging and hands the player back a fresh invite. Rotating the token is what
 * actually severs the old device: its stored session stops matching `judgeHash`, so its very next
 * poll fails authentication and it lands on the expired-invite screen instead of quietly holding
 * the lease. Clearing the lease and presence frees the seat immediately for the next judge.
 */
export async function disconnectPairedGameJudge(input: {
  roomId: string;
  playerToken: string;
}): Promise<{ ok: true; judgeToken: string } | { ok: false }> {
  const context = await readRoom(input.roomId);
  if (!context) return { ok: false };
  // Only the device running the game may evict a judge, and never in a judge-created room where
  // the judge is the host.
  if (
    context.meta.creatorRole !== "player" ||
    !multiplayerCredentialsMatch(input.playerToken, context.meta.playerHash, 200)
  )
    return { ok: false };
  const judgeToken = createMultiplayerCredential();
  const meta: RoomMeta = { ...context.meta, judgeHash: hashMultiplayerCredential(judgeToken) };
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false };
    room.meta = meta;
    room.activeJudgeEpoch = null;
    room.judgeSeenAt = 0;
  } else {
    await redis.set(context.keys.meta, meta, {
      ex: remainingMultiplayerRoomTtlSeconds(meta.expiresAt),
    });
    await redis.del(context.keys.judgeEpoch, context.keys.judgePresence);
  }
  log.info("things.paired-game-room", "Judge disconnected", { game: meta.game });
  return { ok: true, judgeToken };
}

export async function closePairedGameRoom(roomId: string, role: PairedGameRoomRole, token: string) {
  const context = await readRoom(roomId);
  if (!context) return { ok: true, closed: true };
  const valid = multiplayerCredentialsMatch(
    token,
    role === "player" ? context.meta.playerHash : context.meta.judgeHash,
    200,
  );
  if (!valid) return { ok: false, closed: false };
  await renewPairedGameRoom(context);
  const redis = getRedis();
  if (role === "judge" && context.meta.creatorRole === "player") {
    const meta = {
      ...context.meta,
      judgeHash: hashMultiplayerCredential(createMultiplayerCredential()),
    };
    if (!redis) {
      const room = memoryRooms.get(roomId);
      if (!room) return { ok: true, closed: false };
      room.meta = meta;
      room.activeJudgeEpoch = null;
      room.judgeSeenAt = 0;
    } else {
      await redis.set(context.keys.meta, meta, {
        ex: remainingMultiplayerRoomTtlSeconds(meta.expiresAt),
      });
      await redis.del(context.keys.judgeEpoch, context.keys.judgePresence);
    }
    log.info("things.paired-game-room", "Judge left", { game: context.meta.game });
    return { ok: true, closed: false };
  }
  if (!redis) {
    memoryRooms.delete(roomId);
  } else {
    await redis.del(...allPairedGameKeys(roomId));
  }
  log.info("things.paired-game-room", "Room closed", { game: context.meta.game, closedBy: role });
  return { ok: true, closed: true };
}
