import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { remoteRoomRedisKeys } from "../shared/game-keys";
import { createAvailableMultiplayerRoomId, createMultiplayerCredential, hashMultiplayerCredential, multiplayerCredentialsMatch, multiplayerRoomExpired, multiplayerRoomExpiresAt, remainingMultiplayerRoomTtlSeconds } from "../shared/multiplayer-room.server";
import { MULTIPLAYER_ROOM_ID_PATTERN, MULTIPLAYER_ROOM_TTL_SECONDS } from "../shared/multiplayer";
import type {
  RemoteCommand,
  RemoteCommandRequest,
  RemoteGameKind,
  RemoteGameSetup,
  RemoteSyncedSnapshot,
  RemoteJudgeSnapshotResult,
  RemotePlayerSetupResult,
  RemotePlayerSyncResult,
  RemoteRoomCredentials,
  RemoteRoomRole,
} from "./types";

const PRESENCE_TTL_SECONDS = 6;
const JUDGE_LEASE_TTL_SECONDS = 30;
const COMMAND_MAX_AGE_MS = 12_000;

interface RoomMeta {
  game: RemoteGameKind;
  creatorRole: RemoteRoomRole;
  playerHash: string;
  judgeHash: string;
  expiresAt: number;
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

const memoryRooms = new Map<string, MemoryRoom>();

type RemoteRedisKeys = ReturnType<typeof remoteRoomRedisKeys>;

interface RoomContext {
  meta: RoomMeta;
  keys: RemoteRedisKeys;
}

function logSnapshotTransitions(previous: RemoteSyncedSnapshot | null, next: RemoteSyncedSnapshot) {
  const previousIds = new Set(previous?.results.map(({ id }) => id) ?? []);
  const timedOut = next.results.filter(({ id, decision }) => decision === "timed_out" && !previousIds.has(id)).length;
  if (timedOut > 0) log.info("things.remote-room", "Words timed out", { game: next.game, count: timedOut });
}

function rejectJudgeCommand(meta: RoomMeta, command: RemoteCommandRequest, reason: string, error: string) {
  log.info("things.remote-room", "Judge command rejected", { game: meta.game, commandType: command.type, reason });
  return { ok: false as const, error };
}

function targetsKnownResult(snapshot: RemoteSyncedSnapshot | null, command: RemoteCommandRequest) {
  return command.type !== "amend" || Boolean(snapshot?.results.some(({ id }) => id === command.resultId));
}

function allRemoteKeys(roomId: string) {
  return [remoteRoomRedisKeys(roomId), remoteRoomRedisKeys(roomId, true)]
    .flatMap((roomKeys) => Object.values(roomKeys));
}

async function readRoom(roomId: string): Promise<RoomContext | null> {
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(roomId);
    if (!room || multiplayerRoomExpired(room.meta.expiresAt)) {
      memoryRooms.delete(roomId);
      return null;
    }
    return { meta: room.meta, keys: remoteRoomRedisKeys(roomId) };
  }
  for (const roomKeys of [remoteRoomRedisKeys(roomId), remoteRoomRedisKeys(roomId, true)]) {
    const meta = await redis.get<RoomMeta>(roomKeys.meta);
    if (!meta) continue;
    if (multiplayerRoomExpired(meta.expiresAt)) {
      await redis.del(...allRemoteKeys(roomId));
      return null;
    }
    return { meta, keys: roomKeys };
  }
  return null;
}

function roleMatches(meta: RoomMeta, role: RemoteRoomRole, token: string) {
  if (role === "judge" && meta.creatorRole !== "judge") return false;
  return multiplayerCredentialsMatch(token, role === "player" ? meta.playerHash : meta.judgeHash, 200);
}

export async function authorizeRemoteSocket(input: {
  roomId: string;
  role: RemoteRoomRole;
  token: string;
}) {
  if (!MULTIPLAYER_ROOM_ID_PATTERN.test(input.roomId) || !input.token || input.token.length > 100) return false;
  const room = await readRoom(input.roomId);
  if (!room) return false;
  return multiplayerCredentialsMatch(input.token, input.role === "player" ? room.meta.playerHash : room.meta.judgeHash, 100);
}

export async function createRemoteRoom(input: {
  creatorRole: RemoteRoomRole;
  setup: RemoteGameSetup;
}): Promise<RemoteRoomCredentials> {
  const playerToken = createMultiplayerCredential();
  const judgeToken = createMultiplayerCredential();
  const expiresAt = multiplayerRoomExpiresAt();
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) => Boolean(await readRoom(candidate)));
  const meta: RoomMeta = {
    game: input.setup.game,
    creatorRole: input.creatorRole,
    playerHash: hashMultiplayerCredential(playerToken),
    judgeHash: hashMultiplayerCredential(judgeToken),
    expiresAt,
  };
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") {
    log.error("things.remote-room", "Room creation unavailable", { reason: "redis_not_configured" });
    throw new Error("Remote rooms require Redis");
  }
  if (redis) {
    const roomKeys = remoteRoomRedisKeys(roomId);
    await Promise.all([
      redis.set(roomKeys.meta, meta, { ex: MULTIPLAYER_ROOM_TTL_SECONDS }),
      redis.set(roomKeys.setup, input.setup, { ex: MULTIPLAYER_ROOM_TTL_SECONDS }),
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
  log.info("things.remote-room", "Room created", {
    game: input.setup.game,
    creatorRole: input.creatorRole,
    storage: redis ? "redis" : "memory",
  });
  return { roomId, playerToken, judgeToken, creatorRole: input.creatorRole, expiresAt };
}

export async function readRemotePlayerSetup(input: {
  roomId: string;
  playerToken: string;
}): Promise<RemotePlayerSetupResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.playerToken, meta.playerHash)) {
    return { ok: false, setup: null, judgeConnected: false, expiresAt: null, error: "Invite expired" };
  }
  const now = Date.now();
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false, setup: null, judgeConnected: false, expiresAt: null };
    room.playerSeenAt = now;
    return {
      ok: true,
      setup: room.setup,
      judgeConnected: now - room.judgeSeenAt <= PRESENCE_TTL_SECONDS * 1000,
      expiresAt: meta.expiresAt,
    };
  }
  const roomKeys = context.keys;
  await redis.set(roomKeys.playerPresence, now, { ex: PRESENCE_TTL_SECONDS });
  return {
    ok: true,
    setup: await redis.get<RemoteGameSetup>(roomKeys.setup),
    judgeConnected: (await redis.exists(roomKeys.judgePresence)) === 1,
    expiresAt: meta.expiresAt,
  };
}

export async function syncRemotePlayer(input: {
  roomId: string;
  playerToken: string;
  snapshot: RemoteSyncedSnapshot;
  lastCommandSequence: number;
}): Promise<RemotePlayerSyncResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.playerToken, meta.playerHash)) {
    return { ok: false, commands: [], judgeConnected: false, error: "Room unavailable" };
  }
  if (meta.game !== input.snapshot.game) {
    return { ok: false, commands: [], judgeConnected: false, error: "Game mismatch" };
  }
  const now = Date.now();
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false, commands: [], judgeConnected: false };
    if (room.activePlayerEpoch && room.activePlayerEpoch !== input.snapshot.connectionEpoch && now - room.playerSeenAt <= PRESENCE_TTL_SECONDS * 1000) {
      log.warn("things.remote-room", "Player lease rejected", { game: meta.game, reason: "active_epoch" });
      return { ok: false, commands: [], judgeConnected: false, error: "Game is active on another phone" };
    }
    room.activePlayerEpoch = input.snapshot.connectionEpoch;
    if (input.lastCommandSequence > 0) {
      room.commands = room.commands.filter((command) => command.sequence > input.lastCommandSequence);
    }
    room.commands = room.commands.filter((command) => now - command.createdAt <= COMMAND_MAX_AGE_MS);
    if (!room.snapshot || room.snapshot.connectionEpoch !== input.snapshot.connectionEpoch || input.snapshot.revision >= room.snapshot.revision) {
      logSnapshotTransitions(room.snapshot, input.snapshot);
      room.snapshot = { ...input.snapshot, updatedAt: now };
    }
    room.playerSeenAt = now;
    return {
      ok: true,
      commands: room.commands.filter((command) => command.sequence > input.lastCommandSequence),
      judgeConnected: now - room.judgeSeenAt <= PRESENCE_TTL_SECONDS * 1000,
    };
  }

  const roomKeys = context.keys;
  const roomTtl = remainingMultiplayerRoomTtlSeconds(meta.expiresAt);
  const activePlayerEpoch = await redis.get<string>(roomKeys.playerEpoch);
  if (activePlayerEpoch && activePlayerEpoch !== input.snapshot.connectionEpoch) {
    log.warn("things.remote-room", "Player lease rejected", { game: meta.game, reason: "active_epoch" });
    return { ok: false, commands: [], judgeConnected: false, error: "Game is active on another phone" };
  }
  if (activePlayerEpoch) {
    await redis.set(roomKeys.playerEpoch, input.snapshot.connectionEpoch, { ex: PRESENCE_TTL_SECONDS });
  } else {
    const claimed = await redis.set(roomKeys.playerEpoch, input.snapshot.connectionEpoch, { ex: PRESENCE_TTL_SECONDS, nx: true });
    if (!claimed && (await redis.get<string>(roomKeys.playerEpoch)) !== input.snapshot.connectionEpoch) {
      return { ok: false, commands: [], judgeConnected: false, error: "Game is active on another phone" };
    }
  }
  const queuedCommands = await redis.lrange<RemoteCommand>(roomKeys.commands, 0, -1);
  const commands = queuedCommands.filter(
    (command) => command.sequence > input.lastCommandSequence && now - command.createdAt <= COMMAND_MAX_AGE_MS,
  );
  const remainingCommands = queuedCommands.filter(
    (command) => command.sequence > input.lastCommandSequence && now - command.createdAt <= COMMAND_MAX_AGE_MS,
  );
  if (remainingCommands.length !== queuedCommands.length) {
    await redis.del(roomKeys.commands);
    if (remainingCommands.length > 0) {
      await redis.rpush(roomKeys.commands, ...remainingCommands);
      await redis.expire(roomKeys.commands, roomTtl);
    }
  }
  const storedSnapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  const shouldStoreSnapshot = !storedSnapshot || storedSnapshot.connectionEpoch !== input.snapshot.connectionEpoch || input.snapshot.revision >= storedSnapshot.revision;
  if (shouldStoreSnapshot) logSnapshotTransitions(storedSnapshot, input.snapshot);
  await Promise.all([
    shouldStoreSnapshot ? redis.set(roomKeys.snapshot, { ...input.snapshot, updatedAt: now }, { ex: roomTtl }) : Promise.resolve(null),
    redis.set(roomKeys.playerPresence, now, { ex: PRESENCE_TTL_SECONDS }),
  ]);
  return {
    ok: true,
    commands,
    judgeConnected: (await redis.exists(roomKeys.judgePresence)) === 1,
  };
}

export async function readRemoteJudge(input: {
  roomId: string;
  judgeToken: string;
  judgeEpoch: string;
  takeover: boolean;
}): Promise<RemoteJudgeSnapshotResult> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.judgeToken, meta.judgeHash)) {
    return { ok: false, snapshot: null, playerConnected: false, judgeActive: false, expiresAt: null, error: "Invite expired" };
  }
  const now = Date.now();
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false, snapshot: null, playerConnected: false, judgeActive: false, expiresAt: null };
    const leaseExpired = now - room.judgeSeenAt > JUDGE_LEASE_TTL_SECONDS * 1000;
    const judgeActive = input.takeover || leaseExpired || !room.activeJudgeEpoch || room.activeJudgeEpoch === input.judgeEpoch;
    if (judgeActive) {
      if (input.takeover && room.activeJudgeEpoch && room.activeJudgeEpoch !== input.judgeEpoch) {
        log.info("things.remote-room", "Judge control taken over", { game: meta.game, storage: "memory" });
      }
      room.activeJudgeEpoch = input.judgeEpoch;
      room.judgeSeenAt = now;
    }
    return {
      ok: true,
      snapshot: room.snapshot,
      playerConnected: now - room.playerSeenAt <= PRESENCE_TTL_SECONDS * 1000,
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
      log.info("things.remote-room", "Judge control taken over", { game: meta.game, storage: "redis" });
    }
  } else if (judgeActive) {
    await redis.set(roomKeys.judgeEpoch, input.judgeEpoch, { ex: JUDGE_LEASE_TTL_SECONDS });
  } else if (!existingJudgeEpoch) {
    judgeActive = Boolean(await redis.set(roomKeys.judgeEpoch, input.judgeEpoch, { ex: JUDGE_LEASE_TTL_SECONDS, nx: true }));
  }
  if (judgeActive) await redis.set(roomKeys.judgePresence, now, { ex: PRESENCE_TTL_SECONDS });
  return {
    ok: true,
    snapshot: await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot),
    playerConnected: (await redis.exists(roomKeys.playerPresence)) === 1,
    judgeActive,
    expiresAt: meta.expiresAt,
  };
}

export async function sendRemoteJudgeCommand(input: {
  roomId: string;
  judgeToken: string;
  judgeEpoch: string;
  command: RemoteCommandRequest;
}): Promise<{ ok: boolean; sequence?: number; error?: string }> {
  const context = await readRoom(input.roomId);
  const meta = context?.meta;
  if (!context || !meta || !multiplayerCredentialsMatch(input.judgeToken, meta.judgeHash)) return { ok: false, error: "Invite expired" };
  const receivedAt = Date.now();
  const commandAge = receivedAt - input.command.createdAt;
  if (commandAge > COMMAND_MAX_AGE_MS || commandAge < -5_000) return { ok: false, error: "Command expired" };
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false };
    if (room.activeJudgeEpoch !== input.judgeEpoch || receivedAt - room.judgeSeenAt > JUDGE_LEASE_TTL_SECONDS * 1000) return rejectJudgeCommand(meta, input.command, "inactive_judge", "Controls are active on another screen");
    const existingSequence = room.commandSequences.get(input.command.id);
    if (existingSequence !== undefined) return { ok: true, sequence: existingSequence };
    if (room.snapshot?.roundId !== input.command.roundId) return rejectJudgeCommand(meta, input.command, "stale_round", "Round changed");
    if (input.command.type !== "amend" && room.snapshot?.itemId !== input.command.itemId) return rejectJudgeCommand(meta, input.command, "stale_item", "Card changed");
    if (!targetsKnownResult(room.snapshot, input.command)) return rejectJudgeCommand(meta, input.command, "stale_result", "Result changed");
    const isDecision = input.command.type === "correct" || input.command.type === "incorrect" || input.command.type === "pass" || input.command.type === "skip";
    const decisionDeadline = room.snapshot.decisionGraceEndsAt ?? room.snapshot.decisionClosesAt;
    if (isDecision && decisionDeadline && receivedAt > decisionDeadline) {
      return rejectJudgeCommand(meta, input.command, "decision_closed", "Decision window closed");
    }
    if (room.snapshot.transitioning && isDecision) return rejectJudgeCommand(meta, input.command, "transitioning", "Card is changing");
    if (isDecision && room.decidedItems.has(input.command.itemId)) return rejectJudgeCommand(meta, input.command, "already_decided", "Word already decided");
    const queued = { ...input.command, sequence: room.nextSequence++, receivedAt };
    room.commandSequences.set(input.command.id, queued.sequence);
    if (isDecision) room.decidedItems.add(input.command.itemId);
    room.commands.push(queued);
    if (room.commands.length > 50) room.commands.splice(0, room.commands.length - 50);
    return { ok: true, sequence: queued.sequence };
  }
  const roomKeys = context.keys;
  if ((await redis.get<string>(roomKeys.judgeEpoch)) !== input.judgeEpoch) return rejectJudgeCommand(meta, input.command, "inactive_judge", "Controls are active on another screen");
  const existingSequence = await redis.hget<number>(roomKeys.commandIds, input.command.id);
  if (existingSequence !== null) return { ok: true, sequence: existingSequence };
  const rate = await redis.incr(roomKeys.commandRate);
  if (rate === 1) await redis.expire(roomKeys.commandRate, 60);
  if (rate > 120) return { ok: false, error: "Too many controls" };
  const snapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  if (snapshot?.roundId !== input.command.roundId) return rejectJudgeCommand(meta, input.command, "stale_round", "Round changed");
  if (input.command.type !== "amend" && snapshot?.itemId !== input.command.itemId) return rejectJudgeCommand(meta, input.command, "stale_item", "Card changed");
  if (!targetsKnownResult(snapshot, input.command)) return rejectJudgeCommand(meta, input.command, "stale_result", "Result changed");
  const isDecision = input.command.type === "correct" || input.command.type === "incorrect" || input.command.type === "pass" || input.command.type === "skip";
  const decisionDeadline = snapshot.decisionGraceEndsAt ?? snapshot.decisionClosesAt;
  if (isDecision && decisionDeadline && receivedAt > decisionDeadline) {
    return rejectJudgeCommand(meta, input.command, "decision_closed", "Decision window closed");
  }
  if (snapshot.transitioning && isDecision) return rejectJudgeCommand(meta, input.command, "transitioning", "Card is changing");
  const sequence = await redis.incr(roomKeys.commandSequence);
  const roomTtl = remainingMultiplayerRoomTtlSeconds(meta.expiresAt);
  const claimedSequence = await redis.eval<unknown[], number>(
    "local existing=redis.call('hget',KEYS[1],ARGV[1]); if existing then return tonumber(existing) end; if ARGV[2]~='' and redis.call('hexists',KEYS[2],ARGV[2])==1 then return -1 end; redis.call('hset',KEYS[1],ARGV[1],ARGV[3]); if ARGV[2]~='' then redis.call('hset',KEYS[2],ARGV[2],ARGV[3]) end; return tonumber(ARGV[3])",
    [roomKeys.commandIds, roomKeys.decidedItems],
    [input.command.id, isDecision ? hashMultiplayerCredential(input.command.itemId) : "", String(sequence)],
  );
  if (claimedSequence === -1) return rejectJudgeCommand(meta, input.command, "already_decided", "Word already decided");
  if (claimedSequence !== sequence) return { ok: true, sequence: claimedSequence };
  await Promise.all([redis.expire(roomKeys.commandIds, roomTtl), redis.expire(roomKeys.decidedItems, roomTtl)]);
  await redis.rpush(roomKeys.commands, { ...input.command, sequence, receivedAt });
  await redis.ltrim(roomKeys.commands, -50, -1);
  await redis.expire(roomKeys.commands, roomTtl);
  await redis.expire(roomKeys.commandSequence, roomTtl);
  return { ok: true, sequence };
}

export async function closeRemoteRoom(roomId: string, role: RemoteRoomRole, token: string) {
  const context = await readRoom(roomId);
  if (!context) return { ok: true };
  if (!roleMatches(context.meta, role, token)) return { ok: false };
  const redis = getRedis();
  if (!redis) {
    memoryRooms.delete(roomId);
  } else {
    await redis.del(...allRemoteKeys(roomId));
  }
  log.info("things.remote-room", "Room closed", { game: context.meta.game, closedBy: role });
  return { ok: true };
}
