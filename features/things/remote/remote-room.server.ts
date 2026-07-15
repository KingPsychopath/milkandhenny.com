import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import type {
  RemoteCommand,
  RemoteGameKind,
  RemoteGameSnapshot,
  RemoteHostSyncResult,
  RemoteJudgeSnapshotResult,
  RemoteRoomCredentials,
} from "./types";

const ROOM_TTL_SECONDS = 4 * 60 * 60;
const PRESENCE_TTL_SECONDS = 6;
const COMMAND_MAX_AGE_MS = 12_000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface RoomMeta {
  game: RemoteGameKind;
  hostHash: string;
  judgeHash: string;
  expiresAt: number;
}

interface MemoryRoom {
  meta: RoomMeta;
  snapshot: RemoteGameSnapshot | null;
  commands: RemoteCommand[];
  hostSeenAt: number;
  judgeSeenAt: number;
}

const memoryRooms = new Map<string, MemoryRoom>();

function keys(roomId: string) {
  const prefix = `thing-room:${roomId}`;
  return {
    meta: `${prefix}:meta`,
    snapshot: `${prefix}:snapshot`,
    commands: `${prefix}:commands`,
    hostPresence: `${prefix}:host`,
    judgePresence: `${prefix}:judge`,
    commandRate: `${prefix}:command-rate`,
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
  return redis.get<RoomMeta>(keys(roomId).meta);
}

async function touchRedisRoom(roomId: string) {
  const redis = getRedis();
  if (!redis) return;
  const roomKeys = keys(roomId);
  await Promise.all([
    redis.expire(roomKeys.meta, ROOM_TTL_SECONDS),
    redis.expire(roomKeys.snapshot, ROOM_TTL_SECONDS),
    redis.expire(roomKeys.commands, ROOM_TTL_SECONDS),
  ]);
}

export async function createRemoteRoom(game: RemoteGameKind): Promise<RemoteRoomCredentials> {
  const hostToken = randomToken();
  const judgeToken = randomToken();
  const expiresAt = Date.now() + ROOM_TTL_SECONDS * 1000;
  let roomId = randomRoomId();
  for (let attempt = 0; attempt < 4 && (await readMeta(roomId)); attempt += 1) {
    roomId = randomRoomId();
  }
  const meta: RoomMeta = {
    game,
    hostHash: tokenHash(hostToken),
    judgeHash: tokenHash(judgeToken),
    expiresAt,
  };
  const redis = getRedis();
  if (redis) {
    await redis.set(keys(roomId).meta, meta, { ex: ROOM_TTL_SECONDS });
  } else {
    memoryRooms.set(roomId, {
      meta,
      snapshot: null,
      commands: [],
      hostSeenAt: Date.now(),
      judgeSeenAt: 0,
    });
  }
  return { roomId, hostToken, judgeToken, expiresAt };
}

export async function syncRemoteHost(input: {
  roomId: string;
  hostToken: string;
  snapshot: RemoteGameSnapshot;
  acknowledge: number;
}): Promise<RemoteHostSyncResult> {
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.hostToken, meta.hostHash)) {
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
    if (input.acknowledge > 0) room.commands.splice(0, input.acknowledge);
    room.commands = room.commands.filter((command) => now - command.createdAt <= COMMAND_MAX_AGE_MS);
    room.snapshot = { ...input.snapshot, updatedAt: now };
    room.hostSeenAt = now;
    room.meta.expiresAt = now + ROOM_TTL_SECONDS * 1000;
    return {
      ok: true,
      commands: room.commands,
      judgeConnected: now - room.judgeSeenAt <= PRESENCE_TTL_SECONDS * 1000,
    };
  }

  const roomKeys = keys(input.roomId);
  if (input.acknowledge > 0) await redis.ltrim(roomKeys.commands, input.acknowledge, -1);
  const commands = (await redis.lrange<RemoteCommand>(roomKeys.commands, 0, -1)).filter(
    (command) => now - command.createdAt <= COMMAND_MAX_AGE_MS,
  );
  await Promise.all([
    redis.set(roomKeys.snapshot, { ...input.snapshot, updatedAt: now }, { ex: ROOM_TTL_SECONDS }),
    redis.set(roomKeys.hostPresence, now, { ex: PRESENCE_TTL_SECONDS }),
    touchRedisRoom(input.roomId),
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
    return { ok: false, snapshot: null, hostConnected: false, expiresAt: null, error: "Invite expired" };
  }
  const now = Date.now();
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false, snapshot: null, hostConnected: false, expiresAt: null };
    room.judgeSeenAt = now;
    return {
      ok: true,
      snapshot: room.snapshot,
      hostConnected: now - room.hostSeenAt <= PRESENCE_TTL_SECONDS * 1000,
      expiresAt: room.meta.expiresAt,
    };
  }
  const roomKeys = keys(input.roomId);
  await Promise.all([
    redis.set(roomKeys.judgePresence, now, { ex: PRESENCE_TTL_SECONDS }),
    touchRedisRoom(input.roomId),
  ]);
  return {
    ok: true,
    snapshot: await redis.get<RemoteGameSnapshot>(roomKeys.snapshot),
    hostConnected: (await redis.exists(roomKeys.hostPresence)) === 1,
    expiresAt: meta.expiresAt,
  };
}

export async function sendRemoteJudgeCommand(input: {
  roomId: string;
  judgeToken: string;
  command: RemoteCommand;
}): Promise<{ ok: boolean; error?: string }> {
  const meta = await readMeta(input.roomId);
  if (!meta || !tokensMatch(input.judgeToken, meta.judgeHash)) {
    return { ok: false, error: "Invite expired" };
  }
  if (Date.now() - input.command.createdAt > COMMAND_MAX_AGE_MS) {
    return { ok: false, error: "Command expired" };
  }
  const redis = getRedis();
  if (!redis) {
    const room = memoryRooms.get(input.roomId);
    if (!room) return { ok: false };
    if (!room.commands.some(({ id }) => id === input.command.id)) room.commands.push(input.command);
    return { ok: true };
  }
  const roomKeys = keys(input.roomId);
  const rate = await redis.incr(roomKeys.commandRate);
  if (rate === 1) await redis.expire(roomKeys.commandRate, 60);
  if (rate > 120) return { ok: false, error: "Too many controls" };
  await redis.rpush(roomKeys.commands, input.command);
  await redis.expire(roomKeys.commands, ROOM_TTL_SECONDS);
  return { ok: true };
}

export async function closeRemoteRoom(roomId: string, hostToken: string) {
  const meta = await readMeta(roomId);
  if (!meta || !tokensMatch(hostToken, meta.hostHash)) return { ok: false };
  const redis = getRedis();
  if (!redis) {
    memoryRooms.delete(roomId);
    return { ok: true };
  }
  const roomKeys = keys(roomId);
  await redis.del(
    roomKeys.meta,
    roomKeys.snapshot,
    roomKeys.commands,
    roomKeys.hostPresence,
    roomKeys.judgePresence,
    roomKeys.commandRate,
  );
  return { ok: true };
}
