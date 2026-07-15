import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
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

const ROOM_TTL_SECONDS = 4 * 60 * 60;
const PRESENCE_TTL_SECONDS = 6;
const COMMAND_MAX_AGE_MS = 12_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
  nextSequence: number;
  activePlayerEpoch: string | null;
  playerSeenAt: number;
  judgeSeenAt: number;
}

const memoryRooms = new Map<string, MemoryRoom>();

function keys(roomId: string) {
  const prefix = `thing-room:v2:${roomId}`;
  return {
    meta: `${prefix}:meta`,
    setup: `${prefix}:setup`,
    snapshot: `${prefix}:snapshot`,
    commands: `${prefix}:commands`,
    playerPresence: `${prefix}:player`,
    playerEpoch: `${prefix}:player-epoch`,
    judgePresence: `${prefix}:judge`,
    commandRate: `${prefix}:command-rate`,
    commandSequence: `${prefix}:command-sequence`,
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function tokensMatch(token: string, expectedHash: string) {
  if (!token || token.length > 200 || expectedHash.length !== 64) return false;
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function randomToken() {
  return randomBytes(24).toString("base64url");
}

function randomRoomId() {
  const bytes = randomBytes(7);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function roomExpired(meta: RoomMeta) {
  return meta.expiresAt <= Date.now();
}

async function readMeta(roomId: string): Promise<RoomMeta | null> {
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(roomId);
    if (!room || roomExpired(room.meta)) {
      memoryRooms.delete(roomId);
      return null;
    }
    return room.meta;
  }
  const meta = await redis.get<RoomMeta>(keys(roomId).meta);
  return meta && !roomExpired(meta) ? meta : null;
}

function roleMatches(meta: RoomMeta, role: RemoteRoomRole, token: string) {
  if (role === "judge" && meta.creatorRole !== "judge") return false;
  return tokensMatch(token, role === "player" ? meta.playerHash : meta.judgeHash);
}

export async function authorizeRemoteSocket(input: {
  roomId: string;
  role: RemoteRoomRole;
  token: string;
}) {
  if (!/^[A-Z2-9]{7}$/.test(input.roomId) || !input.token || input.token.length > 100) return false;
  const meta = await readMeta(input.roomId);
  if (!meta) return false;
  return tokensMatch(input.token, input.role === "player" ? meta.playerHash : meta.judgeHash);
}

export async function createRemoteRoom(input: {
  creatorRole: RemoteRoomRole;
  setup: RemoteGameSetup;
}): Promise<RemoteRoomCredentials> {
  const playerToken = randomToken();
  const judgeToken = randomToken();
  const expiresAt = Date.now() + ROOM_TTL_SECONDS * 1000;
  let roomId = randomRoomId();
  for (let attempt = 0; attempt < 4 && (await readMeta(roomId)); attempt += 1) roomId = randomRoomId();
  const meta: RoomMeta = {
    game: input.setup.game,
    creatorRole: input.creatorRole,
    playerHash: tokenHash(playerToken),
    judgeHash: tokenHash(judgeToken),
    expiresAt,
  };
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") {
    log.error("things.remote-room", "Room creation unavailable", { reason: "redis_not_configured" });
    throw new Error("Remote rooms require Redis");
  }
  if (redis) {
    const roomKeys = keys(roomId);
    await Promise.all([
      redis.set(roomKeys.meta, meta, { ex: ROOM_TTL_SECONDS }),
      redis.set(roomKeys.setup, input.setup, { ex: ROOM_TTL_SECONDS }),
    ]);
  } else {
    memoryRooms.set(roomId, {
      meta,
      setup: input.setup,
      snapshot: null,
      commands: [],
      nextSequence: 1,
      activePlayerEpoch: null,
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
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.playerToken, meta.playerHash)) {
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
  const roomKeys = keys(input.roomId);
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
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.playerToken, meta.playerHash)) {
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
      return { ok: false, commands: [], judgeConnected: false, error: "Game is active on another phone" };
    }
    room.activePlayerEpoch = input.snapshot.connectionEpoch;
    if (input.lastCommandSequence > 0) {
      room.commands = room.commands.filter((command) => command.sequence > input.lastCommandSequence);
    }
    room.commands = room.commands.filter((command) => now - command.createdAt <= COMMAND_MAX_AGE_MS);
    if (!room.snapshot || room.snapshot.connectionEpoch !== input.snapshot.connectionEpoch || input.snapshot.revision >= room.snapshot.revision) {
      room.snapshot = { ...input.snapshot, updatedAt: now };
    }
    room.playerSeenAt = now;
    return {
      ok: true,
      commands: room.commands.filter((command) => command.sequence > input.lastCommandSequence),
      judgeConnected: now - room.judgeSeenAt <= PRESENCE_TTL_SECONDS * 1000,
    };
  }

  const roomKeys = keys(input.roomId);
  const activePlayerEpoch = await redis.get<string>(roomKeys.playerEpoch);
  if (activePlayerEpoch && activePlayerEpoch !== input.snapshot.connectionEpoch) {
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
      await redis.expire(roomKeys.commands, ROOM_TTL_SECONDS);
    }
  }
  const storedSnapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  const shouldStoreSnapshot = !storedSnapshot || storedSnapshot.connectionEpoch !== input.snapshot.connectionEpoch || input.snapshot.revision >= storedSnapshot.revision;
  await Promise.all([
    shouldStoreSnapshot ? redis.set(roomKeys.snapshot, { ...input.snapshot, updatedAt: now }, { ex: ROOM_TTL_SECONDS }) : Promise.resolve(null),
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
}): Promise<RemoteJudgeSnapshotResult> {
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.judgeToken, meta.judgeHash)) {
    return { ok: false, snapshot: null, playerConnected: false, expiresAt: null, error: "Invite expired" };
  }
  const now = Date.now();
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false, snapshot: null, playerConnected: false, expiresAt: null };
    room.judgeSeenAt = now;
    return {
      ok: true,
      snapshot: room.snapshot,
      playerConnected: now - room.playerSeenAt <= PRESENCE_TTL_SECONDS * 1000,
      expiresAt: meta.expiresAt,
    };
  }
  const roomKeys = keys(input.roomId);
  await redis.set(roomKeys.judgePresence, now, { ex: PRESENCE_TTL_SECONDS });
  return {
    ok: true,
    snapshot: await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot),
    playerConnected: (await redis.exists(roomKeys.playerPresence)) === 1,
    expiresAt: meta.expiresAt,
  };
}

export async function sendRemoteJudgeCommand(input: {
  roomId: string;
  judgeToken: string;
  command: RemoteCommandRequest;
}): Promise<{ ok: boolean; sequence?: number; error?: string }> {
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.judgeToken, meta.judgeHash)) return { ok: false, error: "Invite expired" };
  const commandAge = Date.now() - input.command.createdAt;
  if (commandAge > COMMAND_MAX_AGE_MS || commandAge < -5_000) return { ok: false, error: "Command expired" };
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false };
    if (room.snapshot?.roundId !== input.command.roundId) return { ok: false, error: "Round changed" };
    if (room.snapshot?.itemId !== input.command.itemId) return { ok: false, error: "Card changed" };
    if (room.snapshot.transitioning && (input.command.type === "correct" || input.command.type === "incorrect" || input.command.type === "pass")) return { ok: false, error: "Card is changing" };
    const existing = room.commands.find(({ id }) => id === input.command.id);
    if (existing) return { ok: true, sequence: existing.sequence };
    const queued = { ...input.command, sequence: room.nextSequence++ };
    room.commands.push(queued);
    if (room.commands.length > 50) room.commands.splice(0, room.commands.length - 50);
    return { ok: true, sequence: queued.sequence };
  }
  const roomKeys = keys(input.roomId);
  const rate = await redis.incr(roomKeys.commandRate);
  if (rate === 1) await redis.expire(roomKeys.commandRate, 60);
  if (rate > 120) return { ok: false, error: "Too many controls" };
  const snapshot = await redis.get<RemoteSyncedSnapshot>(roomKeys.snapshot);
  if (snapshot?.roundId !== input.command.roundId) return { ok: false, error: "Round changed" };
  if (snapshot?.itemId !== input.command.itemId) return { ok: false, error: "Card changed" };
  if (snapshot.transitioning && (input.command.type === "correct" || input.command.type === "incorrect" || input.command.type === "pass")) return { ok: false, error: "Card is changing" };
  const sequence = await redis.incr(roomKeys.commandSequence);
  await redis.rpush(roomKeys.commands, { ...input.command, sequence });
  await redis.ltrim(roomKeys.commands, -50, -1);
  await redis.expire(roomKeys.commands, ROOM_TTL_SECONDS);
  await redis.expire(roomKeys.commandSequence, ROOM_TTL_SECONDS);
  return { ok: true, sequence };
}

export async function closeRemoteRoom(roomId: string, role: RemoteRoomRole, token: string) {
  const meta = await readMeta(roomId);
  if (!meta || !roleMatches(meta, role, token)) return { ok: false };
  const redis = getRedis();
  if (!redis) {
    memoryRooms.delete(roomId);
  } else {
    const roomKeys = keys(roomId);
    await redis.del(
      roomKeys.meta,
      roomKeys.setup,
      roomKeys.snapshot,
      roomKeys.commands,
      roomKeys.playerPresence,
      roomKeys.playerEpoch,
      roomKeys.judgePresence,
      roomKeys.commandRate,
      roomKeys.commandSequence,
    );
  }
  log.info("things.remote-room", "Room closed", { game: meta.game, closedBy: role });
  return { ok: true };
}
