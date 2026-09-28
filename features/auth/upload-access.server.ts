import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { PoolClient } from "pg";

import { getCookie } from "@/lib/http/cookies";
import { query, queryOne, transaction } from "@/lib/platform/postgres-provider-context.server";
import { getRedis } from "@/lib/platform/redis.server";

const WINDOW_KEY = "auth:upload-open";
const AUDIT_KEY = "auth:upload-open:audit";
const WINDOW_GRACE_SECONDS = 60;
const AUDIT_LIMIT = 20;
const UPLOAD_WINDOW_LOCK = 8_147_311;
const TOKEN_KEY_ID = "auth-secret-v1";

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

type StoredUploadWindow = {
  id: string;
  token_ciphertext: Buffer;
  token_nonce: Buffer;
  token_auth_tag: Buffer;
  token_key_id: string;
  opened_at: Date;
  expires_at: Date;
  duration_minutes: UploadAccessDurationMinutes;
};

function postgresSelected(): boolean {
  return process.env.UPLOAD_ACCESS_STORE === "postgres";
}

function tokenEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Upload access encryption key unavailable");
  return createHmac("sha256", secret).update("mah:upload-access:key:v1").digest();
}

function tokenAssociatedData(id: string): Buffer {
  return Buffer.from(`mah:upload-access:window:v1:${id}`, "utf8");
}

function encryptToken(id: string, token: string) {
  const key = tokenEncryptionKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(tokenAssociatedData(id));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag() };
  } finally {
    key.fill(0);
  }
}

function decryptToken(row: StoredUploadWindow): string {
  if (row.token_key_id !== TOKEN_KEY_ID) throw new Error("Unsupported upload token key");
  const key = tokenEncryptionKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, row.token_nonce);
    decipher.setAAD(tokenAssociatedData(row.id));
    decipher.setAuthTag(row.token_auth_tag);
    return Buffer.concat([decipher.update(row.token_ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } finally {
    key.fill(0);
  }
}

function toUploadWindow(row: StoredUploadWindow): UploadAccessWindow {
  return {
    id: row.id,
    token: decryptToken(row),
    openedAt: row.opened_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    durationMinutes: row.duration_minutes,
  };
}

async function readPostgresWindow(): Promise<UploadAccessWindow | null> {
  const row = await queryOne<StoredUploadWindow>(
    `select id, token_ciphertext, token_nonce, token_auth_tag, token_key_id,
            opened_at, expires_at, duration_minutes
       from upload_access_window
      where singleton and expires_at > clock_timestamp()`,
  );
  return row ? toUploadWindow(row) : null;
}

async function readPostgresAudit(): Promise<UploadAccessAuditEvent[]> {
  const rows = await query<{
    window_id: string;
    action: "opened" | "closed";
    at: Date;
    duration_minutes: UploadAccessDurationMinutes | null;
  }>(
    `select window_id, action, at, duration_minutes
       from upload_access_audit
      order by at desc, window_id desc
      limit $1`,
    [AUDIT_LIMIT],
  );
  return rows.map((row) => ({
    id: row.window_id,
    action: row.action,
    at: row.at.toISOString(),
    ...(row.duration_minutes ? { durationMinutes: row.duration_minutes } : {}),
  }));
}

async function trimPostgresAudit(client: PoolClient): Promise<void> {
  await client.query(
    `delete from upload_access_audit
      where ctid in (
        select ctid from upload_access_audit
         order by at desc, window_id desc, action desc
         offset $1
      )`,
    [AUDIT_LIMIT],
  );
}

async function openPostgresWindow(window: UploadAccessWindow): Promise<UploadAccessWindow> {
  const encrypted = encryptToken(window.id, window.token);
  await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [UPLOAD_WINDOW_LOCK]);
    await client.query(
      `insert into upload_access_window
         (singleton, id, token_ciphertext, token_nonce, token_auth_tag, token_key_id,
          opened_at, expires_at, duration_minutes)
       values (true, $1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (singleton) do update
         set id = excluded.id,
             token_ciphertext = excluded.token_ciphertext,
             token_nonce = excluded.token_nonce,
             token_auth_tag = excluded.token_auth_tag,
             token_key_id = excluded.token_key_id,
             opened_at = excluded.opened_at,
             expires_at = excluded.expires_at,
             duration_minutes = excluded.duration_minutes`,
      [
        window.id,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.authTag,
        TOKEN_KEY_ID,
        window.openedAt,
        window.expiresAt,
        window.durationMinutes,
      ],
    );
    await client.query(
      `insert into upload_access_audit (window_id, action, at, duration_minutes)
       values ($1, 'opened', $2, $3)`,
      [window.id, window.openedAt, window.durationMinutes],
    );
    await trimPostgresAudit(client);
  });
  return window;
}

async function closePostgresWindow(): Promise<boolean> {
  await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock($1)", [UPLOAD_WINDOW_LOCK]);
    const { rows } = await client.query<{ id: string; active: boolean }>(
      "delete from upload_access_window where singleton returning id, expires_at > clock_timestamp() as active",
    );
    const previous = rows[0];
    if (previous?.active) {
      await client.query(
        `insert into upload_access_audit (window_id, action, at)
         values ($1, 'closed', clock_timestamp())`,
        [previous.id],
      );
      await trimPostgresAudit(client);
    }
  });
  return true;
}

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
  if (postgresSelected()) return readPostgresWindow();
  if (!getRedis() && !isProduction()) {
    if (memoryWindow && isExpired(memoryWindow)) memoryWindow = null;
    return memoryWindow;
  }
  return readRedisWindow();
}

export async function getUploadAccessStatus(): Promise<UploadAccessStatus> {
  const [window, audit] = await Promise.all([
    getUploadAccessWindow(),
    postgresSelected() ? readPostgresAudit() : readRedisAudit(),
  ]);
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
  const usePostgres = postgresSelected();
  const redis = usePostgres ? null : getRedis();
  if (!usePostgres && !redis && isProduction()) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMinutes * 60_000);
  const window: UploadAccessWindow = {
    id: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    openedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMinutes,
  };

  if (usePostgres) return openPostgresWindow(window);
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
  if (postgresSelected()) return closePostgresWindow();
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
