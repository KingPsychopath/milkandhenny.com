import { randomBytes, timingSafeEqual } from 'crypto';
import { getRedis } from './redis';
import { FILE_KINDS, type FileKind } from './media/file-kinds';
import { generateWordId } from './transfer-words';

/* ─── Types ─── */

type TransferFile = {
  /** Unique identifier — filename stem for images, full filename for others */
  id: string;
  /** Original filename with extension (e.g. "DSC00003.jpg", "video.mp4") */
  filename: string;
  /** Determines gallery rendering: image/gif get gallery cards, video gets player, rest get file cards */
  kind: FileKind;
  /** Original file size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Image dimensions (images and gifs only) */
  width?: number;
  height?: number;
  /** EXIF date (processable images only) */
  takenAt?: string;
};

type TransferData = {
  id: string;
  title: string;
  files: TransferFile[];
  createdAt: string;
  expiresAt: string;
  deleteToken: string;
};

/** Summary returned when listing transfers (no delete token exposed) */
type TransferSummary = {
  id: string;
  title: string;
  fileCount: number;
  createdAt: string;
  expiresAt: string;
  /** Seconds until expiry (negative if already expired) */
  remainingSeconds: number;
};

/* ─── Constants ─── */

const TRANSFER_PREFIX = 'transfer:';
const TRANSFER_INDEX_KEY = 'transfer:index';

/** Max expiry: 30 days (safety limit for storage costs) */
const MAX_EXPIRY_SECONDS = 30 * 24 * 60 * 60;

/** Default expiry: 7 days */
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/* ─── ID Generation ─── */

const TRANSFER_ID_STYLE = (process.env.TRANSFER_ID_STYLE ?? 'words') as 'words' | 'random';

/**
 * Generate a URL-safe transfer ID.
 *
 * - `"words"` (default): 3-word hyphenated combo, e.g. "velvet-moon-candle"
 * - `"random"`: 11-char base64url string, e.g. "xK9mP2nQ7vL"
 *
 * Toggle via `TRANSFER_ID_STYLE` env var.
 */
function generateTransferId(): string {
  return TRANSFER_ID_STYLE === 'words'
    ? generateWordId()
    : randomBytes(8).toString('base64url');
}

/** Generate a delete token (22 chars, URL-safe) */
function generateDeleteToken(): string {
  return randomBytes(16).toString('base64url');
}

/* ─── Expiry Parsing ─── */

/**
 * Parse a human-friendly expiry string into seconds.
 * Supports: 30m, 1h, 12h, 1d, 7d, 14d, 30d
 */
function parseExpiry(input: string): number {
  const match = input.trim().match(/^(\d+)([dhm])$/i);
  if (!match) {
    throw new Error(
      `Invalid expiry format "${input}". Use: 30m, 1h, 12h, 1d, 7d, 14d, 30d`
    );
  }

  const num = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  let seconds: number;
  switch (unit) {
    case 'd':
      seconds = num * 86400;
      break;
    case 'h':
      seconds = num * 3600;
      break;
    case 'm':
      seconds = num * 60;
      break;
    default:
      throw new Error(`Unknown time unit "${unit}"`);
  }

  if (seconds <= 0) {
    throw new Error('Expiry must be greater than 0');
  }
  if (seconds > MAX_EXPIRY_SECONDS) {
    throw new Error(`Expiry cannot exceed 30 days (got ${input})`);
  }

  return seconds;
}

/** Format seconds into a human-readable duration */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'expired';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);

  return parts.join(' ') || '< 1m';
}

/* ─── Redis Operations ─── */

/** In-memory fallback for local development */
const memoryTransfers = new Map<string, TransferData>();
const memoryIndex = new Set<string>();

/** Save a new transfer to Redis with TTL */
async function saveTransfer(
  data: TransferData,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
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

/** Get a transfer by ID. Returns null if expired or not found. */
async function getTransfer(id: string): Promise<TransferData | null> {
  const redis = getRedis();
  const key = `${TRANSFER_PREFIX}${id}`;

  if (redis) {
    const raw = await redis.get<string>(key);
    if (!raw) {
      await redis.srem(TRANSFER_INDEX_KEY, id);
      return null;
    }
    return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as TransferData;
  }

  return memoryTransfers.get(key) ?? null;
}

/** List all active (non-expired) transfers */
async function listTransfers(): Promise<TransferSummary[]> {
  const redis = getRedis();
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

      const data: TransferData = typeof raw === 'string' ? JSON.parse(raw) : raw as TransferData;
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
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
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
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Delete a transfer from Redis. Returns true if it existed. */
async function deleteTransferData(id: string): Promise<boolean> {
  const redis = getRedis();
  const key = `${TRANSFER_PREFIX}${id}`;

  if (redis) {
    const [deleted] = await Promise.all([
      redis.del(key),
      redis.srem(TRANSFER_INDEX_KEY, id),
    ]);
    return deleted > 0;
  }

  const existed = memoryTransfers.has(key);
  memoryTransfers.delete(key);
  memoryIndex.delete(id);
  return existed;
}

/** Validate a delete token against a transfer */
async function validateDeleteToken(id: string, token: string): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const transfer = await getTransfer(id);
  if (!transfer) return false;
  const expected = Buffer.from(transfer.deleteToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export {
  saveTransfer,
  getTransfer,
  listTransfers,
  deleteTransferData,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  parseExpiry,
  formatDuration,
  DEFAULT_EXPIRY_SECONDS,
  MAX_EXPIRY_SECONDS,
  FILE_KINDS,
};

export type { TransferData, TransferFile, TransferSummary, FileKind };
