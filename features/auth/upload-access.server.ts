import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { getCookie } from "@/lib/http/cookies";
import { getRedis } from "@/lib/platform/redis.server";

const WINDOW_KEY = "auth:upload-open";
const AUDIT_KEY = "auth:upload-open:audit";
const WINDOW_GRACE_SECONDS = 60;
const AUDIT_LIMIT = 20;

export const UPLOAD_ACCESS_COOKIE = "mah-upload-open";
export const UPLOAD_ACCESS_DURATIONS = [15, 60] as const;
export type UploadAccessDurationMinutes = (typeof UPLOAD_ACCESS_DURATIONS)[number];

export type UploadAccessWindow = {
  id: string;
  token: string;
  openedAt: string;
  expiresAt: string;
  durationMinutes: UploadAccessDurationMinutes;
};

export type UploadAccessAuditEvent = {
  id: string;
  action: "opened" | "closed";
  at: string;
  durationMinutes?: UploadAccessDurationMinutes;
};

export type UploadAccessStatus = {
  active: boolean;
  openedAt?: string;
  expiresAt?: string;
  durationMinutes?: UploadAccessDurationMinutes;
  audit: UploadAccessAuditEvent[];
};

let memoryWindow: UploadAccessWindow | null = null;
let memoryAudit: UploadAccessAuditEvent[] = [];

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function isDurationMinutes(value: unknown): value is UploadAccessDurationMinutes {
  return value === 15 || value === 60;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseWindow(value: unknown): UploadAccessWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<UploadAccessWindow>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.token !== "string" ||
    typeof candidate.openedAt !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    !isDurationMinutes(candidate.durationMinutes)
  ) {
    return null;
  }
  if (!Number.isFinite(Date.parse(candidate.expiresAt))) return null;
  return {
    id: candidate.id,
    token: candidate.token,
    openedAt: candidate.openedAt,
    expiresAt: candidate.expiresAt,
    durationMinutes: candidate.durationMinutes,
  };
}

function parseAudit(value: unknown): UploadAccessAuditEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<UploadAccessAuditEvent>;
  if (
    typeof candidate.id !== "string" ||
    (candidate.action !== "opened" && candidate.action !== "closed") ||
    typeof candidate.at !== "string" ||
    !Number.isFinite(Date.parse(candidate.at))
  ) {
    return null;
  }
  return {
    id: candidate.id,
    action: candidate.action,
    at: candidate.at,
    ...(isDurationMinutes(candidate.durationMinutes)
      ? { durationMinutes: candidate.durationMinutes }
      : {}),
  };
}

function isExpired(window: UploadAccessWindow): boolean {
  return Date.parse(window.expiresAt) <= Date.now();
}

async function readRedisWindow(): Promise<UploadAccessWindow | null> {
  const redis = getRedis();
  if (!redis) return isProduction() ? null : memoryWindow;
  try {
    const value = await redis.get<UploadAccessWindow>(WINDOW_KEY);
    const window = parseWindow(value);
    if (window && !isExpired(window)) return window;
    if (window) await redis.del(WINDOW_KEY);
    return null;
  } catch {
    return null;
  }
}

async function readRedisAudit(): Promise<UploadAccessAuditEvent[]> {
  const redis = getRedis();
  if (!redis) return isProduction() ? [] : memoryAudit;
  try {
    const entries = await redis.lrange<unknown>(AUDIT_KEY, 0, AUDIT_LIMIT - 1);
    return entries
      .map(parseAudit)
      .filter((event): event is UploadAccessAuditEvent => event !== null);
  } catch {
    return [];
  }
}

async function recordAudit(event: UploadAccessAuditEvent): Promise<void> {
  memoryAudit = [event, ...memoryAudit].slice(0, AUDIT_LIMIT);
  const redis = getRedis();
  if (!redis) return;
  await redis.lpush(AUDIT_KEY, JSON.stringify(event));
  await redis.ltrim(AUDIT_KEY, 0, AUDIT_LIMIT - 1);
}

export async function getUploadAccessWindow(): Promise<UploadAccessWindow | null> {
  if (!getRedis() && !isProduction()) {
    if (memoryWindow && isExpired(memoryWindow)) memoryWindow = null;
    return memoryWindow;
  }
  return readRedisWindow();
}

export async function getUploadAccessStatus(): Promise<UploadAccessStatus> {
  const [window, audit] = await Promise.all([getUploadAccessWindow(), readRedisAudit()]);
  return window
    ? {
        active: true,
        openedAt: window.openedAt,
        expiresAt: window.expiresAt,
        durationMinutes: window.durationMinutes,
        audit,
      }
    : { active: false, audit };
}

export async function openUploadAccess(
  durationMinutes: UploadAccessDurationMinutes,
): Promise<UploadAccessWindow | null> {
  if (!isDurationMinutes(durationMinutes)) return null;
  const redis = getRedis();
  if (!redis && isProduction()) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const window: UploadAccessWindow = {
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    openedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMinutes,
  };

  memoryWindow = window;
  if (redis) {
    await redis.set(WINDOW_KEY, window, {
      ex: durationMinutes * 60 + WINDOW_GRACE_SECONDS,
    });
  }
  await recordAudit({
    id: window.id,
    action: "opened",
    at: window.openedAt,
    durationMinutes,
  });
  return window;
}

export async function closeUploadAccess(): Promise<boolean> {
  const redis = getRedis();
  if (!redis && isProduction()) return false;
  const existing = await getUploadAccessWindow();
  memoryWindow = null;
  if (redis) await redis.del(WINDOW_KEY);
  if (existing) {
    await recordAudit({ id: existing.id, action: "closed", at: new Date().toISOString() });
  }
  return true;
}

export async function authenticateUploadAccess(request: Request): Promise<{
  token: string;
  window: UploadAccessWindow;
} | null> {
  const cookie = getCookie(request, UPLOAD_ACCESS_COOKIE);
  if (!cookie) return null;
  const window = await getUploadAccessWindow();
  if (!window || !safeEqual(cookie, window.token)) return null;
  return { token: cookie, window };
}

export function toUploadAccessCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction(),
    path: "/",
    maxAge: Math.max(0, Math.floor(maxAge)),
  };
}
