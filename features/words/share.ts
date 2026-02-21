import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { getRedis } from "@/lib/platform/redis";
import {
  SHARE_DEFAULT_EXPIRY_DAYS,
  SHARE_MAX_EXPIRY_DAYS,
  SHARE_RECORD_RETENTION_DAYS,
  SHARE_PIN_LOCKOUT_SECONDS,
  SHARE_PIN_MAX_ATTEMPTS,
  wordShareIndexKey,
  wordSharePinRateLimitKey,
  wordShareKey,
  wordShareSlugsKey,
} from "./config";
import type { ShareLink } from "./content-types";

type AccessTokenPayload = {
  slug: string;
  shareId: string;
  exp: number;
  tokenHash: string;
  pinUpdatedAt?: string;
};

const memoryShares = new Map<string, ShareLink>();
const memoryShareIndex = new Map<string, Set<string>>();
const memoryShareSlugs = new Set<string>();
const memoryPinRateLimit = new Map<string, { attempts: number; resetAtMs: number }>();

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function getTokenSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  return Buffer.from(padded, "base64");
}

function wordAccessCookieName(slug: string): string {
  return `mah-word-access-${slug}`;
}

function parseExpiryDays(input?: number): number {
  if (!Number.isFinite(input)) return SHARE_DEFAULT_EXPIRY_DAYS;
  return Math.min(Math.max(Math.floor(input as number), 1), SHARE_MAX_EXPIRY_DAYS);
}

function shareRecordTtlSeconds(link: ShareLink): number {
  const nowMs = Date.now();
  const expiryMs = new Date(link.expiresAt).getTime();
  const anchorMs = Number.isFinite(expiryMs) ? Math.max(expiryMs, nowMs) : nowMs;
  const ttlMs = anchorMs - nowMs + SHARE_RECORD_RETENTION_DAYS * 86400 * 1000;
  return Math.max(3600, Math.ceil(ttlMs / 1000));
}

async function getShareById(id: string): Promise<ShareLink | null> {
  const redis = getRedis();
  if (redis) {
    const raw = await redis.get<ShareLink | string>(wordShareKey(id));
    if (!raw) return null;
    return typeof raw === "string" ? (JSON.parse(raw) as ShareLink) : raw;
  }
  return memoryShares.get(id) ?? null;
}

async function setShare(link: ShareLink): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await Promise.all([
      redis.set(wordShareKey(link.id), JSON.stringify(link), { ex: shareRecordTtlSeconds(link) }),
      redis.sadd(wordShareIndexKey(link.slug), link.id),
      redis.sadd(wordShareSlugsKey(), link.slug),
    ]);
    return;
  }
  memoryShares.set(link.id, link);
  const set = memoryShareIndex.get(link.slug) ?? new Set<string>();
  set.add(link.id);
  memoryShareIndex.set(link.slug, set);
  memoryShareSlugs.add(link.slug);
}

async function listShareLinks(slug: string): Promise<ShareLink[]> {
  const redis = getRedis();
  if (redis) {
    const ids = (await redis.smembers(wordShareIndexKey(slug))) as string[];
    if (ids.length === 0) return [];
    const links = await Promise.all(ids.map((id) => getShareById(id)));
    return links
      .filter((l): l is ShareLink => !!l && l.slug === slug)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  const ids = memoryShareIndex.get(slug);
  if (!ids) return [];
  const links = [...ids].map((id) => memoryShares.get(id)).filter((l): l is ShareLink => !!l);
  return links.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

type ShareCleanupResult = {
  slug: string;
  scanned: number;
  removedExpired: number;
  removedRevoked: number;
  staleIndexRemoved: number;
  remaining: number;
};

async function listTrackedShareSlugs(): Promise<string[]> {
  const redis = getRedis();
  if (redis) {
    const slugs = (await redis.smembers(wordShareSlugsKey())) as string[];
    return slugs.filter((slug) => typeof slug === "string" && !!slug);
  }
  return [...memoryShareSlugs];
}

async function cleanupShareLinksForSlug(
  slug: string,
  nowMs = Date.now()
): Promise<ShareCleanupResult> {
  const redis = getRedis();
  const indexKey = wordShareIndexKey(slug);
  let removedExpired = 0;
  let removedRevoked = 0;
  let staleIndexRemoved = 0;

  if (redis) {
    const ids = (await redis.smembers(indexKey)) as string[];
    if (ids.length === 0) {
      await redis.srem(wordShareSlugsKey(), slug);
      return { slug, scanned: 0, removedExpired, removedRevoked, staleIndexRemoved, remaining: 0 };
    }

    const links = await Promise.all(ids.map((id) => getShareById(id)));
    const staleIds: string[] = [];
    const removeIds: string[] = [];

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const link = links[i];
      if (!link || link.slug !== slug) {
        staleIds.push(id);
        continue;
      }
      const isExpired = new Date(link.expiresAt).getTime() <= nowMs;
      if (link.revokedAt) {
        removeIds.push(id);
        removedRevoked += 1;
        continue;
      }
      if (isExpired) {
        removeIds.push(id);
        removedExpired += 1;
      }
    }

    if (staleIds.length > 0 || removeIds.length > 0) {
      const pipeline = redis.pipeline();
      for (const staleId of staleIds) {
        pipeline.srem(indexKey, staleId);
      }
      for (const removeId of removeIds) {
        pipeline.del(wordShareKey(removeId));
        pipeline.srem(indexKey, removeId);
      }
      await pipeline.exec();
      staleIndexRemoved = staleIds.length;
    }

    const remaining = await redis.scard(indexKey);
    if (remaining === 0) {
      await redis.srem(wordShareSlugsKey(), slug);
    }
    return {
      slug,
      scanned: ids.length,
      removedExpired,
      removedRevoked,
      staleIndexRemoved,
      remaining: Math.max(0, Number(remaining)),
    };
  }

  const ids = memoryShareIndex.get(slug);
  if (!ids || ids.size === 0) {
    memoryShareSlugs.delete(slug);
    return { slug, scanned: 0, removedExpired, removedRevoked, staleIndexRemoved, remaining: 0 };
  }

  const nextIds = new Set<string>(ids);
  for (const id of ids) {
    const link = memoryShares.get(id);
    if (!link || link.slug !== slug) {
      nextIds.delete(id);
      staleIndexRemoved += 1;
      continue;
    }
    const isExpired = new Date(link.expiresAt).getTime() <= nowMs;
    if (link.revokedAt) {
      memoryShares.delete(id);
      nextIds.delete(id);
      removedRevoked += 1;
      continue;
    }
    if (isExpired) {
      memoryShares.delete(id);
      nextIds.delete(id);
      removedExpired += 1;
    }
  }

  if (nextIds.size === 0) {
    memoryShareIndex.delete(slug);
    memoryShareSlugs.delete(slug);
  } else {
    memoryShareIndex.set(slug, nextIds);
    memoryShareSlugs.add(slug);
  }

  return {
    slug,
    scanned: ids.size,
    removedExpired,
    removedRevoked,
    staleIndexRemoved,
    remaining: nextIds.size,
  };
}

async function revokeShareLink(slug: string, id: string): Promise<boolean> {
  const link = await getShareById(id);
  if (!link || link.slug !== slug) return false;
  const nowIso = new Date().toISOString();
  await setShare({ ...link, revokedAt: nowIso, updatedAt: nowIso });
  return true;
}

async function deleteAllShareLinksForSlug(slug: string): Promise<number> {
  const redis = getRedis();
  const indexKey = wordShareIndexKey(slug);

  if (redis) {
    const ids = (await redis.smembers(indexKey)) as string[];
    if (ids.length === 0) {
      await redis.srem(wordShareSlugsKey(), slug);
      return 0;
    }
    const pipeline = redis.pipeline();
    for (const id of ids) {
      pipeline.del(wordShareKey(id));
      pipeline.srem(indexKey, id);
    }
    pipeline.del(indexKey);
    pipeline.srem(wordShareSlugsKey(), slug);
    await pipeline.exec();
    return ids.length;
  }

  const ids = memoryShareIndex.get(slug);
  if (!ids || ids.size === 0) {
    memoryShareSlugs.delete(slug);
    return 0;
  }
  for (const id of ids) {
    memoryShares.delete(id);
  }
  memoryShareIndex.delete(slug);
  memoryShareSlugs.delete(slug);
  return ids.size;
}

async function createShareLink(input: {
  slug: string;
  expiresInDays?: number;
  pinRequired?: boolean;
  pin?: string;
}): Promise<{ link: ShareLink; token: string }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + parseExpiryDays(input.expiresInDays) * 86400 * 1000).toISOString();
  const token = randomBytes(24).toString("base64url");
  const pinRequired = !!input.pinRequired;
  const trimmedPin = input.pin?.trim() || "";

  if (pinRequired && !trimmedPin) {
    throw new Error("PIN is required when pinRequired is true.");
  }

  const link: ShareLink = {
    id: randomUUID(),
    slug: input.slug,
    tokenHash: sha256(token),
    expiresAt,
    pinRequired,
    pinHash: pinRequired ? sha256(trimmedPin) : undefined,
    pinUpdatedAt: pinRequired ? nowIso : undefined,
    revokedAt: undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByRole: "admin",
  };

  await setShare(link);
  return { link, token };
}

async function updateShareLink(
  slug: string,
  id: string,
  updates: {
    pinRequired?: boolean;
    pin?: string | null;
    expiresInDays?: number;
    rotateToken?: boolean;
  }
): Promise<{ link: ShareLink; token?: string } | null> {
  const current = await getShareById(id);
  if (!current || current.slug !== slug) return null;
  const hasPinMutation = typeof updates.pinRequired === "boolean" || updates.pin !== undefined;
  if (hasPinMutation && !isShareUsable(current)) {
    throw new Error("Cannot update PIN on an expired or revoked share link.");
  }

  let next = { ...current };
  const nowIso = new Date().toISOString();
  let nextToken: string | undefined;

  if (Number.isFinite(updates.expiresInDays)) {
    const days = parseExpiryDays(updates.expiresInDays);
    next.expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
  }

  if (updates.rotateToken) {
    nextToken = randomBytes(24).toString("base64url");
    next.tokenHash = sha256(nextToken);
  }

  if (typeof updates.pinRequired === "boolean") {
    next.pinRequired = updates.pinRequired;
    if (!updates.pinRequired) {
      next.pinHash = undefined;
      next.pinUpdatedAt = nowIso;
    }
  }

  if (updates.pin === null) {
    next.pinHash = undefined;
    next.pinRequired = false;
    next.pinUpdatedAt = nowIso;
  } else if (typeof updates.pin === "string") {
    const trimmed = updates.pin.trim();
    if (!trimmed) {
      throw new Error("PIN cannot be empty.");
    }
    next.pinHash = sha256(trimmed);
    next.pinRequired = true;
    next.pinUpdatedAt = nowIso;
  }

  if (next.pinRequired && !next.pinHash) {
    throw new Error("PIN hash missing for pin-protected share link.");
  }

  next.updatedAt = nowIso;
  await setShare(next);
  return { link: next, token: nextToken };
}

async function checkPinRateLimit(shareId: string, ip: string): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    const key = wordSharePinRateLimitKey(shareId, ip);
    const attempts = (await redis.get<number>(key)) ?? 0;
    if (attempts >= SHARE_PIN_MAX_ATTEMPTS) return false;
    return true;
  }
  const key = `${shareId}:${ip}`;
  const now = Date.now();
  const item = memoryPinRateLimit.get(key);
  if (!item || item.resetAtMs <= now) {
    memoryPinRateLimit.set(key, { attempts: 0, resetAtMs: now + SHARE_PIN_LOCKOUT_SECONDS * 1000 });
    return true;
  }
  return item.attempts < SHARE_PIN_MAX_ATTEMPTS;
}

async function recordPinFailure(shareId: string, ip: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const key = wordSharePinRateLimitKey(shareId, ip);
    await redis.incr(key);
    await redis.expire(key, SHARE_PIN_LOCKOUT_SECONDS);
    return;
  }
  const key = `${shareId}:${ip}`;
  const now = Date.now();
  const item = memoryPinRateLimit.get(key);
  if (!item || item.resetAtMs <= now) {
    memoryPinRateLimit.set(key, { attempts: 1, resetAtMs: now + SHARE_PIN_LOCKOUT_SECONDS * 1000 });
    return;
  }
  memoryPinRateLimit.set(key, { ...item, attempts: item.attempts + 1 });
}

async function clearPinFailures(shareId: string, ip: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.del(wordSharePinRateLimitKey(shareId, ip));
    return;
  }
  memoryPinRateLimit.delete(`${shareId}:${ip}`);
}

function isShareUsable(link: ShareLink): boolean {
  if (link.revokedAt) return false;
  return new Date(link.expiresAt).getTime() > Date.now();
}

async function verifyShareForToken(
  slug: string,
  rawToken: string
): Promise<ShareLink | null> {
  const tokenHash = sha256(rawToken);
  const links = await listShareLinks(slug);
  for (const link of links) {
    if (!isShareUsable(link)) continue;
    if (safeCompareStrings(link.tokenHash, tokenHash)) {
      return link;
    }
  }
  return null;
}

async function verifyShareLinkAccess(input: {
  slug: string;
  token: string;
  pin?: string;
  ip: string;
}): Promise<{ ok: true; link: ShareLink } | { ok: false; error: string; status: number; pinRequired?: boolean }> {
  const token = input.token.trim();
  if (!token) {
    return { ok: false, error: "Share token is required.", status: 400 };
  }

  const link = await verifyShareForToken(input.slug, token);
  if (!link) {
    return { ok: false, error: "Invalid or expired share link.", status: 401 };
  }

  if (!link.pinRequired) {
    return { ok: true, link };
  }

  const allowed = await checkPinRateLimit(link.id, input.ip);
  if (!allowed) {
    return { ok: false, error: "Too many invalid PIN attempts. Try again later.", status: 429, pinRequired: true };
  }

  const pin = input.pin?.trim() || "";
  if (!pin || !link.pinHash) {
    return { ok: false, error: "PIN is required for this share link.", status: 401, pinRequired: true };
  }

  const candidate = sha256(pin);
  if (!safeCompareStrings(candidate, link.pinHash)) {
    await recordPinFailure(link.id, input.ip);
    return { ok: false, error: "Invalid PIN.", status: 401, pinRequired: true };
  }

  await clearPinFailures(link.id, input.ip);
  return { ok: true, link };
}

function signWordAccessToken(link: ShareLink): string | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AccessTokenPayload = {
    slug: link.slug,
    shareId: link.id,
    exp: Math.floor(new Date(link.expiresAt).getTime() / 1000),
    tokenHash: link.tokenHash,
    pinUpdatedAt: link.pinUpdatedAt,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const message = `${headerB64}.${payloadB64}`;
  const sig = createHmac("sha256", secret).update(message).digest();
  return `${message}.${base64UrlEncode(sig)}`;
}

function decodeNoteAccessToken(token: string): AccessTokenPayload | null {
  const secret = getTokenSecret();
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const message = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(message).digest();
  const actual = base64UrlDecode(sigB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString()) as AccessTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function verifyWordAccessToken(slug: string, token: string): Promise<boolean> {
  const payload = decodeNoteAccessToken(token);
  if (!payload) return false;
  if (payload.slug !== slug) return false;

  const link = await getShareById(payload.shareId);
  if (!link || link.slug !== slug) return false;
  if (!isShareUsable(link)) return false;
  if (!safeCompareStrings(link.tokenHash, payload.tokenHash)) return false;

  if (link.pinRequired) {
    if (!payload.pinUpdatedAt) return false;
    if ((link.pinUpdatedAt ?? "") > payload.pinUpdatedAt) return false;
  }

  return true;
}

export {
  wordAccessCookieName,
  listShareLinks,
  listTrackedShareSlugs,
  cleanupShareLinksForSlug,
  createShareLink,
  updateShareLink,
  revokeShareLink,
  deleteAllShareLinksForSlug,
  verifyShareLinkAccess,
  signWordAccessToken,
  verifyWordAccessToken,
};
