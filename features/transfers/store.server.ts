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

/**
 * Upload constraints for public transfers (enforced in upload API routes; admins are exempt).
 * Large files use multipart transport; aggregate allowance remains an independent product rule.
 */
const MAX_TRANSFER_FILE_BYTES = 50 * 1024 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_TRANSFER_FILES = 500;
const MAX_TRANSFER_TITLE_LENGTH = 160;

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

function normaliseTransferTitle(value: unknown): string {
  if (typeof value !== "string") return "untitled";
  const title = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TRANSFER_TITLE_LENGTH);
  return title || "untitled";
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
      "local raw = redis.call('get', KEYS[1]); if not raw then return 0 end; local transfer = cjson.decode(raw); for i, current in ipairs(transfer.files) do if current.id == ARGV[1] then local replacement = cjson.decode(ARGV[2]); if not replacement.storedBytes and current.storedBytes then replacement.storedBytes = current.storedBytes end; transfer.files[i] = replacement; redis.call('set', KEYS[1], cjson.encode(transfer), 'KEEPTTL'); return 1 end end; return 0",
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
  const current = files[fileIndex];
  files[fileIndex] =
    file.storedBytes === undefined && current?.storedBytes !== undefined
      ? { ...file, storedBytes: current.storedBytes }
      : file;
  memoryTransfers.set(key, { ...transfer, files });
  return true;
}

type AppendTransferFilesResult =
  | { status: "updated"; transfer: TransferData }
  | { status: "missing" | "conflict" | "limit" };

type AppendTransferFilesLimits = {
  maxFiles?: number;
  maxTotalBytes?: number;
};

/** Append metadata without replacing worker updates or files added by another request. */
async function appendTransferFiles(
  transferId: string,
  files: TransferFile[],
  limits: AppendTransferFilesLimits = {},
): Promise<AppendTransferFilesResult> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${transferId}`;
  if (redis) {
    const result = await redis.eval<string[], string>(
      "local raw = redis.call('get', KEYS[1]); if not raw then return '__missing__' end; local transfer = cjson.decode(raw); local incoming = cjson.decode(ARGV[1]); local maxFiles = tonumber(ARGV[2]); local maxBytes = tonumber(ARGV[3]); if maxFiles > 0 and #transfer.files + #incoming > maxFiles then return '__limit__' end; local occupied = {}; local ids = {}; local bytes = 0; for _, current in ipairs(transfer.files) do ids[current.id] = true; occupied[current.filename] = true; if current.originalFilename then occupied[current.originalFilename] = true end; bytes = bytes + (current.storedBytes or current.size or 0) end; for _, added in ipairs(incoming) do if ids[added.id] or occupied[added.filename] or (added.originalFilename and occupied[added.originalFilename]) then return '__conflict__' end; ids[added.id] = true; occupied[added.filename] = true; if added.originalFilename then occupied[added.originalFilename] = true end; bytes = bytes + (added.storedBytes or added.size or 0) end; if maxBytes > 0 and bytes > maxBytes then return '__limit__' end; for _, added in ipairs(incoming) do table.insert(transfer.files, added) end; redis.call('set', KEYS[1], cjson.encode(transfer), 'KEEPTTL'); return cjson.encode(transfer)",
      [key],
      [JSON.stringify(files), String(limits.maxFiles ?? 0), String(limits.maxTotalBytes ?? 0)],
    );
    if (result === "__missing__") return { status: "missing" };
    if (result === "__conflict__") return { status: "conflict" };
    if (result === "__limit__") return { status: "limit" };
    return { status: "updated", transfer: JSON.parse(result) as TransferData };
  }

  const transfer = memoryTransfers.get(key);
  if (!transfer) return { status: "missing" };
  const ids = new Set(transfer.files.map((file) => file.id));
  const names = new Set(
    transfer.files.flatMap((file) =>
      [file.filename, file.originalFilename].filter(
        (name): name is string => typeof name === "string",
      ),
    ),
  );
  for (const file of files) {
    if (ids.has(file.id) || names.has(file.filename) || names.has(file.originalFilename ?? "")) {
      return { status: "conflict" };
    }
    ids.add(file.id);
    names.add(file.filename);
    if (file.originalFilename) names.add(file.originalFilename);
  }
  if (limits.maxFiles && transfer.files.length + files.length > limits.maxFiles) {
    return { status: "limit" };
  }
  if (limits.maxTotalBytes) {
    const bytes = [...transfer.files, ...files].reduce(
      (total, file) => total + (file.storedBytes ?? file.size),
      0,
    );
    if (bytes > limits.maxTotalBytes) return { status: "limit" };
  }
  const updated = { ...transfer, files: [...transfer.files, ...files] };
  memoryTransfers.set(key, updated);
  return { status: "updated", transfer: updated };
}

/** Reorder and regroup a stable file set while preserving each file's latest processing fields. */
async function updateTransferGrouping(
  transferId: string,
  files: TransferFile[],
  groups: AssetGroup[] | undefined,
): Promise<boolean> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${transferId}`;
  if (redis) {
    const updated = await redis.eval<string[], number>(
      "local raw = redis.call('get', KEYS[1]); if not raw then return 0 end; local transfer = cjson.decode(raw); local desired = cjson.decode(ARGV[1]); if #transfer.files ~= #desired then return 0 end; local currentById = {}; for _, current in ipairs(transfer.files) do currentById[current.id] = current end; local ordered = {}; for _, target in ipairs(desired) do local current = currentById[target.id]; if not current then return 0 end; current.groupId = nil; current.groupRole = nil; if target.groupId then current.groupId = target.groupId end; if target.groupRole then current.groupRole = target.groupRole end; table.insert(ordered, current) end; transfer.files = ordered; local groups = cjson.decode(ARGV[2]); if #groups > 0 then transfer.groups = groups else transfer.groups = nil end; redis.call('set', KEYS[1], cjson.encode(transfer), 'KEEPTTL'); return 1",
      [key],
      [
        JSON.stringify(
          files.map((file) => ({
            id: file.id,
            groupId: file.groupId,
            groupRole: file.groupRole,
          })),
        ),
        JSON.stringify(groups ?? []),
      ],
    );
    return updated === 1;
  }

  const transfer = memoryTransfers.get(key);
  if (!transfer || transfer.files.length !== files.length) return false;
  const currentById = new Map(transfer.files.map((file) => [file.id, file]));
  if (files.some((file) => !currentById.has(file.id))) return false;
  const updatedFiles = files.map((file) => {
    const current = { ...currentById.get(file.id)! };
    delete current.groupId;
    delete current.groupRole;
    if (file.groupId) current.groupId = file.groupId;
    if (file.groupRole) current.groupRole = file.groupRole;
    return current;
  });
  memoryTransfers.set(key, { ...transfer, files: updatedFiles, groups });
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

type RemoveTransferFileResult =
  | { status: "updated"; transfer: TransferData }
  | { status: "deleted" }
  | { status: "missing" | "file-missing" };

/** Remove one file against the latest value so sibling updates cannot be resurrected. */
async function removeTransferFileAtomic(
  transferId: string,
  fileId: string,
): Promise<RemoveTransferFileResult> {
  const redis = requireTransferRedis();
  const key = `${TRANSFER_PREFIX}${transferId}`;
  if (redis) {
    const result = await redis.eval<string[], string>(
      "local raw = redis.call('get', KEYS[1]); if not raw then return '__missing__' end; local transfer = cjson.decode(raw); local found = false; local files = {}; for _, file in ipairs(transfer.files) do if file.id == ARGV[1] then found = true else table.insert(files, file) end end; if not found then return '__file_missing__' end; transfer.files = files; local clear = {}; local groups = {}; for _, group in ipairs(transfer.groups or {}) do local touched = false; local members = {}; for _, member in ipairs(group.members or {}) do if member.fileId == ARGV[1] then touched = true else table.insert(members, member) end end; if touched then if #members >= 2 then group.members = members; table.insert(groups, group) else for _, member in ipairs(members) do clear[member.fileId] = true end end else table.insert(groups, group) end end; for _, file in ipairs(transfer.files) do if clear[file.id] then file.groupId = nil; file.groupRole = nil end end; if #groups > 0 then transfer.groups = groups else transfer.groups = nil end; if #transfer.files == 0 then redis.call('del', KEYS[1]); redis.call('srem', KEYS[2], ARGV[2]); return '__deleted__' end; redis.call('set', KEYS[1], cjson.encode(transfer), 'KEEPTTL'); return cjson.encode(transfer)",
      [key, TRANSFER_INDEX_KEY],
      [fileId, transferId],
    );
    if (result === "__missing__") return { status: "missing" };
    if (result === "__file_missing__") return { status: "file-missing" };
    if (result === "__deleted__") return { status: "deleted" };
    return { status: "updated", transfer: JSON.parse(result) as TransferData };
  }

  const transfer = memoryTransfers.get(key);
  if (!transfer) return { status: "missing" };
  if (!transfer.files.some((file) => file.id === fileId)) return { status: "file-missing" };
  const updated = removeTransferFile(transfer, fileId);
  if (updated.files.length === 0) {
    memoryTransfers.delete(key);
    memoryIndex.delete(transferId);
    return { status: "deleted" };
  }
  memoryTransfers.set(key, updated);
  return { status: "updated", transfer: updated };
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
/**
 * Every live transfer, in one pipelined round trip.
 *
 * Callers that need the files (reconciliation, admin views) would otherwise do
 * a `GET` per id. Expired ids found along the way are pruned from the index as
 * a side effect, which is the only place that garbage gets collected.
 */
async function listTransferData(): Promise<TransferData[]> {
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

    const live: TransferData[] = [];
    const expiredIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const raw = results[i];
      if (!raw) {
        expiredIds.push(ids[i]);
        continue;
      }

      const data: TransferData = typeof raw === "string" ? JSON.parse(raw) : (raw as TransferData);
      if (new Date(data.expiresAt).getTime() - now <= 0) {
        expiredIds.push(ids[i]);
        continue;
      }

      live.push(data);
    }

    if (expiredIds.length > 0) {
      const cleanupPipeline = redis.pipeline();
      for (const id of expiredIds) {
        cleanupPipeline.srem(TRANSFER_INDEX_KEY, id);
      }
      await cleanupPipeline.exec();
    }

    return live;
  }

  // Memory fallback
  return [...memoryTransfers.values()].filter(
    (data) => new Date(data.expiresAt).getTime() - now > 0,
  );
}

async function listTransfers(): Promise<TransferSummary[]> {
  const now = Date.now();
  const redis = requireTransferRedis();

  if (redis) {
    const live = await listTransferData();
    return live
      .map((data) => ({
        id: data.id,
        title: data.title,
        fileCount: data.files.length,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        remainingSeconds: Math.floor((new Date(data.expiresAt).getTime() - now) / 1000),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  appendTransferFiles,
  updateTransferGrouping,
  createTransfer,
  getTransfer,
  listTransfers,
  listTransferData,
  deleteTransferData,
  removeTransferFile,
  removeTransferFileAtomic,
  removeTransferFileFromGroups,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  formatDuration,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_FILES,
  MAX_TRANSFER_TITLE_LENGTH,
  MAX_TRANSFER_TOTAL_BYTES,
  normaliseTransferTitle,
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
