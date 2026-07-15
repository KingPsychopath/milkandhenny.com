import { randomBytes, timingSafeEqual } from "crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { FILE_KINDS } from "@/features/media/file-kinds";
import type { AssetGroup, TransferData, TransferFile, TransferSummary } from "./types";

/* ─── Constants ─── */

const TRANSFER_PREFIX = "transfer:";
const TRANSFER_INDEX_KEY = "transfer:index";

/** Max expiry: 30 days (safety limit for storage costs) */
const MAX_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/** Default expiry: 7 days */
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Upload constraints (enforced in upload API routes) */
const MAX_TRANSFER_FILE_BYTES = 250 * 1024 * 1024; // 250MB
const MAX_TRANSFER_TOTAL_BYTES = 1024 * 1024 * 1024; // 1GB

/* ─── ID Generation ─── */

/**
 * Generate a 128-bit URL-safe capability ID. Anyone with this ID can view the transfer.
 */
function generateTransferId(): string {
  return randomBytes(16).toString("base64url");
}

/** Generate a delete token (22 chars, URL-safe) */
function generateDeleteToken(): string {
  return randomBytes(16).toString("base64url");
}

/* ─── Expiry Parsing ─── */

/**
 * Parse a human-friendly expiry string into seconds.
 * Supports: 30m, 1h, 12h, 1d, 7d, 14d, 30d
 */
function parseExpiry(input: string): number {
  const match = input.trim().match(/^(\d+)([dhm])$/i);
  if (!match) {
    throw new Error(`Invalid expiry format "${input}". Use: 30m, 1h, 12h, 1d, 7d, 14d, 30d`);
  }

  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let seconds: number;
  switch (unit) {
    case "d":
      seconds = num * 86400;
      break;
    case "h":
      seconds = num * 3600;
      break;
    case "m":
      seconds = num * 60;
      break;
    default:
      throw new Error(`Unknown time unit "${unit}"`);
  }

  if (seconds <= 0) {
    throw new Error("Expiry must be greater than 0");
  }
  if (seconds > MAX_EXPIRY_SECONDS) {
    throw new Error(`Expiry cannot exceed 30 days (got ${input})`);
  }

  return seconds;
}

/** Format seconds into a human-readable duration */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expired";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

  return parts.join(" ") || "< 1m";
}

/* ─── Redis Operations ─── */

/** In-memory fallback for local development */
const memoryTransfers = new Map<string, TransferData>();
const memoryIndex = new Set<string>();

function allowInMemoryTransferStore(): boolean {
  return process.env.NODE_ENV === "test" || process.env.ALLOW_IN_MEMORY_TRANSFER_STORE === "1";
}

function requireTransferRedis() {
  const redis = getRedis();
  if (redis) return redis;
  if (allowInMemoryTransferStore()) return null;
  throw new Error(
    "Transfer storage requires Redis. Configure REDIS_REST_URL and REDIS_REST_TOKEN.",
  );
}

/** Save a new transfer to Redis with TTL */
async function saveTransfer(data: TransferData, ttlSeconds: number): Promise<void> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${data.id}`;

  if (redis) {
    await Promise.all([
      redis.set(key, JSON.stringify(data), { ex: ttlSeconds }),
      redis.sadd(TRANSFER_INDEX_KEY, data.id),
    ]);
  } else {
    memoryTransfers.set(key, data);
    memoryIndex.add(data.id);
    setTimeout(() => {
      memoryTransfers.delete(key);
      memoryIndex.delete(data.id);
    }, ttlSeconds * 1000);
  }
}

/** Create a transfer exactly once. Existing capability IDs are never overwritten. */
async function createTransfer(data: TransferData, ttlSeconds: number): Promise<boolean> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${data.id}`;

  if (redis) {
    const created = await redis.set(key, JSON.stringify(data), { ex: ttlSeconds, nx: true });
    if (!created) return false;
    try {
      await redis.sadd(TRANSFER_INDEX_KEY, data.id);
    } catch (error) {
      await redis.del(key).catch(() => undefined);
      throw error;
    }
    return true;
  }

  if (memoryTransfers.has(key)) return false;
  memoryTransfers.set(key, data);
  memoryIndex.add(data.id);
  setTimeout(() => {
    memoryTransfers.delete(key);
    memoryIndex.delete(data.id);
  }, ttlSeconds * 1000).unref?.();
  return true;
}

/** Merge one file into the latest transfer value without overwriting sibling worker updates. */
async function updateTransferFile(transferId: string, file: TransferFile): Promise<boolean> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${transferId}`;
  if (redis) {
    const updated = await redis.eval<string[], number>(
      "local raw = redis.call('get', KEYS[1]); if not raw then return 0 end; local transfer = cjson.decode(raw); for i, current in ipairs(transfer.files) do if current.id == ARGV[1] then transfer.files[i] = cjson.decode(ARGV[2]); redis.call('set', KEYS[1], cjson.encode(transfer), 'KEEPTTL'); return 1 end end; return 0",
      [key],
      [file.id, JSON.stringify(file)],
    );
    return updated === 1;
  }

  const transfer = memoryTransfers.get(key);
  if (!transfer) return false;
  const fileIndex = transfer.files.findIndex((candidate) => candidate.id === file.id);
  if (fileIndex === -1) return false;
  const files = [...transfer.files];
  files[fileIndex] = file;
  memoryTransfers.set(key, { ...transfer, files });
  return true;
}

function clearTransferFileGroup(file: TransferFile): TransferFile {
  const next = { ...file };
  delete next.groupId;
  delete next.groupRole;
  return next;
}

function removeTransferFileFromGroups(data: TransferData, fileId: string): TransferData {
  if (!data.groups || data.groups.length === 0) return data;

  let groupsChanged = false;
  let clearedIds: string[] = [];
  const nextGroups: AssetGroup[] = [];

  for (const group of data.groups) {
    if (!group.members.some((member) => member.fileId === fileId)) {
      nextGroups.push(group);
      continue;
    }

    groupsChanged = true;
    const remainingMembers = group.members.filter((member) => member.fileId !== fileId);
    if (remainingMembers.length >= 2) {
      nextGroups.push({ ...group, members: remainingMembers });
    } else {
      clearedIds = [...clearedIds, ...remainingMembers.map((member) => member.fileId)];
    }
  }

  if (!groupsChanged) return data;

  const clearSet = new Set(clearedIds);
  const files = data.files.map((file) => {
    if (file.id === fileId || clearSet.has(file.id)) return clearTransferFileGroup(file);
    return file;
  });

  return {
    ...data,
    files,
    groups: nextGroups.length > 0 ? nextGroups : undefined,
  };
}

function removeTransferFile(data: TransferData, fileId: string): TransferData {
  const next = removeTransferFileFromGroups(data, fileId);
  return {
    ...next,
    files: next.files.filter((file) => file.id !== fileId),
  };
}

/** Get a transfer by ID. Returns null if expired or not found. */
async function getTransfer(id: string): Promise<TransferData | null> {
  const key = `${TRANSFER_PREFIX}${id}`;
  const redis = getRedis();

  if (redis) {
    const raw = await redis.get<string>(key);
    if (!raw) {
      await redis.srem(TRANSFER_INDEX_KEY, id);
      return null;
    }
    return typeof raw === "string" ? JSON.parse(raw) : (raw as unknown as TransferData);
  }

  return allowInMemoryTransferStore() ? (memoryTransfers.get(key) ?? null) : null;
}

/** List all active (non-expired) transfers */
async function listTransfers(): Promise<TransferSummary[]> {
  const redis = requireTransferRedis();
  const now = Date.now();

  if (redis) {
    const ids = await redis.smembers(TRANSFER_INDEX_KEY);
    if (ids.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.get(`${TRANSFER_PREFIX}${id}`);
    }
    const results = await pipeline.exec();

    const summaries: TransferSummary[] = [];
    const expiredIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const raw = results[i];
      if (!raw) {
        expiredIds.push(ids[i]);
        continue;
      }

      const data: TransferData = typeof raw === "string" ? JSON.parse(raw) : (raw as TransferData);
      const expiresMs = new Date(data.expiresAt).getTime();
      const remaining = Math.floor((expiresMs - now) / 1000);

      if (remaining <= 0) {
        expiredIds.push(ids[i]);
        continue;
      }

      summaries.push({
        id: data.id,
        title: data.title,
        fileCount: data.files.length,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        remainingSeconds: remaining,
      });
    }

    if (expiredIds.length > 0) {
      const cleanupPipeline = redis.pipeline();
      for (const id of expiredIds) {
        cleanupPipeline.srem(TRANSFER_INDEX_KEY, id);
      }
      await cleanupPipeline.exec();
    }

    return summaries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  // Memory fallback
  const summaries: TransferSummary[] = [];
  for (const [, data] of memoryTransfers) {
    const expiresMs = new Date(data.expiresAt).getTime();
    const remaining = Math.floor((expiresMs - now) / 1000);
    if (remaining <= 0) continue;

    summaries.push({
      id: data.id,
      title: data.title,
      fileCount: data.files.length,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      remainingSeconds: remaining,
    });
  }

  return summaries.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Delete a transfer from Redis. Returns true if it existed. */
async function deleteTransferData(id: string): Promise<boolean> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${id}`;

  if (redis) {
    const [deleted] = await Promise.all([redis.del(key), redis.srem(TRANSFER_INDEX_KEY, id)]);
    return deleted > 0;
  }

  const existed = memoryTransfers.has(key);
  memoryTransfers.delete(key);
  memoryIndex.delete(id);
  return existed;
}

/** Validate a delete token against a transfer */
async function validateDeleteToken(id: string, token: string): Promise<boolean> {
  if (!token || typeof token !== "string") return false;
  const transfer = await getTransfer(id);
  if (!transfer) return false;
  const expected = Buffer.from(transfer.deleteToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export {
  saveTransfer,
  updateTransferFile,
  createTransfer,
  getTransfer,
  listTransfers,
  deleteTransferData,
  removeTransferFile,
  removeTransferFileFromGroups,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  formatDuration,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
  FILE_KINDS,
};

export type {
  AssetGroup,
  AssetGroupMember,
  TransferData,
  TransferFile,
  TransferSummary,
  FileKind,
} from "./types";
