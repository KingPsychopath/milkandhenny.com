import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres-provider-context.server";
import type { RevocableRole, TokenPayload, TokenSessionSource } from "./token-session.server";

const TOKEN_KEY_ID = "auth-secret-v1";
const DEDUPE_KEY = /^auth:recent-login:(admin|upload):([a-f0-9]{24})$/;

export function postgresTokenStoreSelected(): boolean {
  return process.env.AUTH_TOKEN_STORE === "postgres";
}

function encryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Auth token encryption key unavailable");
  return createHmac("sha256", secret).update("mah:auth-recent-login:key:v1").digest();
}

function associatedData(role: string, fingerprint: string): Buffer {
  return Buffer.from(`mah:auth-recent-login:v1:${role}:${fingerprint}`, "utf8");
}

function encryptRecentToken(role: string, fingerprint: string, token: string) {
  const key = encryptionKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData(role, fingerprint));
    const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag() };
  } finally {
    key.fill(0);
  }
}

export async function getPostgresRoleVersion(role: RevocableRole): Promise<number> {
  const row = await queryOne<{ version: number }>(
    "select version from auth_role_token_versions where role = $1",
    [role],
  );
  return row?.version ?? 1;
}

export async function incrementPostgresRoleVersion(role: RevocableRole): Promise<number> {
  const row = await queryOne<{ version: number }>(
    `insert into auth_role_token_versions (role, version) values ($1, 2)
       on conflict (role) do update
         set version = auth_role_token_versions.version + 1, source_rdb_sha256 = null
       returning version`,
    [role],
  );
  if (!row) throw new Error("Could not increment token version");
  return row.version;
}

export async function getPostgresTokenValidation(
  jti: string,
  role: RevocableRole,
): Promise<{ revoked: boolean; version: number }> {
  const row = await queryOne<{ revoked: boolean; version: number }>(
    `select exists(
         select 1 from auth_revoked_tokens
          where jti = $1 and expires_at > clock_timestamp()
       ) as revoked,
       coalesce((select version from auth_role_token_versions where role = $2), 1) as version`,
    [jti, role],
  );
  if (!row) throw new Error("Could not read token validation state");
  return row;
}

export async function getPostgresRecentLogin(dedupeKey: string): Promise<string | null> {
  const match = DEDUPE_KEY.exec(dedupeKey);
  if (!match) throw new Error("Invalid login deduplication key");
  const [, role, fingerprint] = match;
  const row = await queryOne<{
    token_ciphertext: Buffer;
    token_nonce: Buffer;
    token_auth_tag: Buffer;
    token_key_id: string;
  }>(
    `select token_ciphertext, token_nonce, token_auth_tag, token_key_id
       from auth_recent_logins
      where role = $1 and fingerprint = $2 and expires_at > clock_timestamp()`,
    [role, fingerprint],
  );
  if (!row) return null;
  if (row.token_key_id !== TOKEN_KEY_ID) throw new Error("Unsupported recent login key");
  const key = encryptionKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, row.token_nonce);
    decipher.setAAD(associatedData(role, fingerprint));
    decipher.setAuthTag(row.token_auth_tag);
    return Buffer.concat([decipher.update(row.token_ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } finally {
    key.fill(0);
  }
}

export async function registerPostgresTokenSession(
  payload: TokenPayload,
  token: string,
  metadata: { ip: string; ua: string; source: TokenSessionSource },
  dedupeKey?: string,
): Promise<boolean> {
  const match = dedupeKey ? DEDUPE_KEY.exec(dedupeKey) : null;
  if (dedupeKey && (!match || match[1] !== payload.role))
    throw new Error("Invalid login deduplication key");
  const sealed = match ? encryptRecentToken(match[1], match[2], token) : null;
  return transaction(async (client) => {
    const inserted = await client.query(
      `insert into auth_token_sessions
         (jti, role, issued_at, expires_at, token_version, ip, ua, source)
       values ($1, $2, to_timestamp($3), to_timestamp($4), $5, $6, $7, $8)
       on conflict (jti) do nothing
       returning jti`,
      [
        payload.jti,
        payload.role,
        payload.iat,
        payload.exp,
        payload.tv,
        metadata.ip.slice(0, 128),
        metadata.ua.slice(0, 256),
        metadata.source,
      ],
    );
    if (inserted.rowCount !== 1) return false;
    if (match && sealed) {
      await client.query(
        `insert into auth_recent_logins
           (role, fingerprint, token_ciphertext, token_nonce, token_auth_tag,
            token_key_id, expires_at)
         values ($1, $2, $3, $4, $5, $6, clock_timestamp() + interval '15 seconds')
         on conflict (role, fingerprint) do update
           set token_ciphertext = excluded.token_ciphertext,
               token_nonce = excluded.token_nonce,
               token_auth_tag = excluded.token_auth_tag,
               token_key_id = excluded.token_key_id,
               expires_at = excluded.expires_at`,
        [match[1], match[2], sealed.ciphertext, sealed.nonce, sealed.authTag, TOKEN_KEY_ID],
      );
    }
    return true;
  });
}

export async function revokePostgresToken(jti: string, exp: number): Promise<void> {
  await query(
    `insert into auth_revoked_tokens (jti, expires_at) values ($1, to_timestamp($2))
       on conflict (jti) do update
         set expires_at = greatest(auth_revoked_tokens.expires_at, excluded.expires_at)`,
    [jti, exp],
  );
}

export async function revokePostgresRegisteredToken(jti: string): Promise<number | null> {
  const row = await queryOne<{ expires_at: Date }>(
    "select expires_at from auth_token_sessions where jti = $1",
    [jti],
  );
  if (!row) return null;
  await revokePostgresToken(jti, Math.floor(row.expires_at.getTime() / 1000) + 60);
  return Math.max(1, Math.floor(row.expires_at.getTime() / 1000) - Math.floor(Date.now() / 1000));
}

export async function listPostgresTokenSessions(limit: number) {
  const [counts, rows, versions] = await Promise.all([
    queryOne<{ total: string }>("select count(*)::text as total from auth_token_sessions"),
    query<{
      jti: string;
      role: RevocableRole;
      iat: string;
      exp: string;
      tv: number;
      ip: string | null;
      ua: string | null;
      source: TokenSessionSource;
      revoked: boolean;
    }>(
      `select s.jti, s.role, extract(epoch from s.issued_at)::bigint::text as iat,
              extract(epoch from s.expires_at)::bigint::text as exp, s.token_version as tv,
              s.ip, s.ua, s.source,
              exists(select 1 from auth_revoked_tokens r
                      where r.jti = s.jti and r.expires_at > clock_timestamp()) as revoked
         from auth_token_sessions s
        order by s.issued_at desc, s.jti desc
        limit $1`,
      [limit],
    ),
    query<{ role: RevocableRole; version: number }>(
      "select role, version from auth_role_token_versions",
    ),
  ]);
  const currentTv = {
    admin: versions.find((row) => row.role === "admin")?.version ?? 1,
    upload: versions.find((row) => row.role === "upload")?.version ?? 1,
  };
  const now = Math.floor(Date.now() / 1000);
  const sessions = rows.map((row) => {
    const iat = Number(row.iat);
    const exp = Number(row.exp);
    const status =
      exp <= now
        ? ("expired" as const)
        : row.revoked
          ? ("revoked" as const)
          : row.tv !== currentTv[row.role]
            ? ("invalidated" as const)
            : ("active" as const);
    return {
      jti: row.jti,
      role: row.role,
      iat,
      exp,
      tv: row.tv,
      ip: row.ip ?? undefined,
      ua: row.ua ?? undefined,
      source: row.source,
      status,
    };
  });
  const totalIndexed = Number(counts?.total ?? "0");
  return {
    success: true,
    count: sessions.length,
    totalIndexed,
    truncated: totalIndexed > limit,
    sessions,
    now,
    currentTv,
  };
}

export async function cleanupPostgresTokenState(limit = 10_000) {
  if (!postgresTokenStoreSelected())
    return { skipped: true, sessions: 0, revocations: 0, recentLogins: 0 };
  const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const [sessions, revocations, recentLogins] = await Promise.all([
    query(
      `delete from auth_token_sessions where ctid in (
         select ctid from auth_token_sessions
          where expires_at < clock_timestamp() - interval '60 days'
          order by expires_at limit $1
       ) returning jti`,
      [bounded],
    ),
    query(
      `delete from auth_revoked_tokens where ctid in (
         select ctid from auth_revoked_tokens
          where expires_at < clock_timestamp()
          order by expires_at limit $1
       ) returning jti`,
      [bounded],
    ),
    query(
      `delete from auth_recent_logins where ctid in (
         select ctid from auth_recent_logins
          where expires_at < clock_timestamp()
          order by expires_at limit $1
       ) returning role`,
      [bounded],
    ),
  ]);
  return {
    skipped: false,
    sessions: sessions.length,
    revocations: revocations.length,
    recentLogins: recentLogins.length,
  };
}
