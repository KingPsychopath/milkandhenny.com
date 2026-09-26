import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  query,
  queryOne,
  transaction,
  withPostgresClient,
} from "@/lib/platform/postgres-provider-context.server";
import type { CliAuthorizationRecord } from "./cli-auth.server";

const TOKEN_KEY_ID = "auth-secret-v1";
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._`-]{43,128}$/;

export function postgresCliAuthSelected(): boolean {
  return process.env.AUTH_CLI_STORE === "postgres";
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("CLI auth secret unavailable");
  return secret;
}

function hashCapability(purpose: "request" | "code", value: string): string {
  return createHmac("sha256", authSecret())
    .update(`mah:cli-auth:${purpose}:v1:${value}`)
    .digest("hex");
}

function encryptionKey(): Buffer {
  return createHmac("sha256", authSecret()).update("mah:cli-auth:seal:v1").digest();
}

function seal(value: string, associated: string) {
  const key = encryptionKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(associated));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return { ciphertext, nonce, authTag: cipher.getAuthTag() };
  } finally {
    key.fill(0);
  }
}

function open(
  row: { ciphertext: Buffer; nonce: Buffer; authTag: Buffer; keyId: string },
  associated: string,
): string {
  if (row.keyId !== TOKEN_KEY_ID) throw new Error("Unsupported CLI auth key");
  const key = encryptionKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, row.nonce);
    decipher.setAAD(Buffer.from(associated));
    decipher.setAuthTag(row.authTag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  } finally {
    key.fill(0);
  }
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_PATTERN.test(verifier)) return false;
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const expected = Buffer.from(challenge);
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function createPostgresCliRequest(
  requestId: string,
  record: CliAuthorizationRecord,
): Promise<void> {
  const requestHash = hashCapability("request", requestId);
  const rows = await query(
    `insert into auth_cli_requests (request_hash, request_data, expires_at)
       values ($1, $2::jsonb, clock_timestamp() + interval '5 minutes')
       on conflict (request_hash) do nothing returning request_hash`,
    [requestHash, JSON.stringify(record)],
  );
  if (rows.length !== 1) throw new Error("CLI request collision");
}

export async function getPostgresCliRequest(
  requestId: string,
): Promise<CliAuthorizationRecord | null> {
  const row = await queryOne<{ request_data: CliAuthorizationRecord }>(
    `select request_data from auth_cli_requests
      where request_hash = $1 and status = 'pending' and expires_at > clock_timestamp()`,
    [hashCapability("request", requestId)],
  );
  return row?.request_data ?? null;
}

function callbackRedirect(record: CliAuthorizationRecord, values: Record<string, string>): string {
  const url = new URL(record.redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  url.searchParams.set("state", record.state);
  return url.toString();
}

export async function completePostgresCliRequest(
  requestId: string,
  decision: "approved" | "denied",
  issueToken?: (record: CliAuthorizationRecord) => Promise<string | null>,
): Promise<{ redirectUri: string } | null> {
  const requestHash = hashCapability("request", requestId);
  return transaction(async (client) => {
    const { rows } = await client.query<{
      request_data: CliAuthorizationRecord;
      status: "pending" | "approved" | "denied";
      redirect_ciphertext: Buffer | null;
      redirect_nonce: Buffer | null;
      redirect_auth_tag: Buffer | null;
      redirect_key_id: string | null;
    }>(
      `select request_data, status, redirect_ciphertext, redirect_nonce,
              redirect_auth_tag, redirect_key_id
         from auth_cli_requests
        where request_hash = $1 and expires_at > clock_timestamp()
        for update`,
      [requestHash],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "pending") {
      if (
        !row.redirect_ciphertext ||
        !row.redirect_nonce ||
        !row.redirect_auth_tag ||
        !row.redirect_key_id
      ) {
        throw new Error("Completed CLI request lacks redirect");
      }
      return {
        redirectUri: open(
          {
            ciphertext: row.redirect_ciphertext,
            nonce: row.redirect_nonce,
            authTag: row.redirect_auth_tag,
            keyId: row.redirect_key_id,
          },
          `mah:cli-auth:redirect:v1:${requestHash}`,
        ),
      };
    }
    const record = row.request_data;
    let redirectUri: string;
    if (decision === "approved") {
      if (!issueToken) throw new Error("CLI token issuer unavailable");
      const token = await withPostgresClient(client, () => issueToken(record));
      if (!token) return null;
      const code = randomBytes(32).toString("base64url");
      const codeHash = hashCapability("code", code);
      const encryptedToken = seal(token, `mah:cli-auth:code:v1:${codeHash}`);
      await client.query(
        `insert into auth_cli_codes
           (code_hash, token_ciphertext, token_nonce, token_auth_tag,
            token_key_id, code_challenge, expires_at)
         values ($1, $2, $3, $4, $5, $6, clock_timestamp() + interval '60 seconds')`,
        [
          codeHash,
          encryptedToken.ciphertext,
          encryptedToken.nonce,
          encryptedToken.authTag,
          TOKEN_KEY_ID,
          record.codeChallenge,
        ],
      );
      redirectUri = callbackRedirect(record, { code });
    } else {
      redirectUri = callbackRedirect(record, { error: "access_denied" });
    }
    const encryptedRedirect = seal(redirectUri, `mah:cli-auth:redirect:v1:${requestHash}`);
    await client.query(
      `update auth_cli_requests
          set status = $2, redirect_ciphertext = $3, redirect_nonce = $4,
              redirect_auth_tag = $5, redirect_key_id = $6,
              expires_at = clock_timestamp() + interval '60 seconds'
        where request_hash = $1`,
      [
        requestHash,
        decision,
        encryptedRedirect.ciphertext,
        encryptedRedirect.nonce,
        encryptedRedirect.authTag,
        TOKEN_KEY_ID,
      ],
    );
    return { redirectUri };
  });
}

export async function consumePostgresCliCode(
  code: string,
  verifier: string,
): Promise<string | null> {
  const codeHash = hashCapability("code", code);
  return transaction(async (client) => {
    const { rows } = await client.query<{
      token_ciphertext: Buffer;
      token_nonce: Buffer;
      token_auth_tag: Buffer;
      token_key_id: string;
      code_challenge: string;
    }>(
      `select token_ciphertext, token_nonce, token_auth_tag, token_key_id, code_challenge
         from auth_cli_codes
        where code_hash = $1 and expires_at > clock_timestamp() and consumed_at is null
        for update`,
      [codeHash],
    );
    const row = rows[0];
    if (!row || !pkceMatches(verifier, row.code_challenge)) return null;
    const token = open(
      {
        ciphertext: row.token_ciphertext,
        nonce: row.token_nonce,
        authTag: row.token_auth_tag,
        keyId: row.token_key_id,
      },
      `mah:cli-auth:code:v1:${codeHash}`,
    );
    await client.query(
      "update auth_cli_codes set consumed_at = clock_timestamp() where code_hash = $1",
      [codeHash],
    );
    return token;
  });
}

export async function cleanupPostgresCliAuth(limit = 10_000) {
  if (!postgresCliAuthSelected()) return { skipped: true, requests: 0, codes: 0 };
  const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const [requests, codes] = await Promise.all([
    query(
      `delete from auth_cli_requests where ctid in (
         select ctid from auth_cli_requests
          where expires_at < clock_timestamp()
          order by expires_at limit $1
       ) returning request_hash`,
      [bounded],
    ),
    query(
      `delete from auth_cli_codes where ctid in (
         select ctid from auth_cli_codes
          where expires_at < clock_timestamp()
          order by expires_at limit $1
       ) returning code_hash`,
      [bounded],
    ),
  ]);
  return { skipped: false, requests: requests.length, codes: codes.length };
}
