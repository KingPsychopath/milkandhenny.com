import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";

import {
  completeAttendeeMfaSession,
  getAttendeeSession,
  pendingMfaIsFresh,
  revokeAttendeeSessionsForPerson,
  stepUpAttendeeSession,
} from "@/features/attendee-access/session.server";
import { queryOne, transaction } from "@/lib/platform/postgres.server";
import { getRedis } from "@/lib/platform/redis.server";
import { SITE_NAME } from "@/lib/shared/config";
import { sendPersonSecurityNotice } from "./security-notifications.server";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const MANAGEMENT_STEP_UP_MS = 10 * 60 * 1_000;
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_MAXIMUM = 10;
const RATE_PREFIX = "attendee-totp:rate:v1:";
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_CODE_COUNT = 10;

export type TotpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; code?: string };

export type TotpStatus = {
  enabled: boolean;
  label?: string;
  createdAt?: string;
  lastUsedAt?: string;
  recoveryCodesRemaining: number;
};

type TotpRow = {
  id: string;
  person_id: string;
  label: string;
  secret_ciphertext: string;
  last_counter: string | number | null;
  created_at: Date;
  verified_at: Date | null;
  last_used_at: Date | null;
};

const developmentRates = new Map<string, { count: number; expiresAt: number }>();

function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function encryptionKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("milkandhenny/auth-encryption", "utf8"),
      Buffer.from("totp-secret/v1", "utf8"),
      32,
    ),
  );
}

function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

function decryptSecret(value: string, secret: string): string {
  const [version, encodedIv, encodedCiphertext, encodedTag] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag) {
    throw new Error("Invalid encrypted TOTP secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function recoveryCode(): string {
  const bytes = randomBytes(12);
  const characters = Array.from(
    bytes,
    (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length],
  ).join("");
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8)}`;
}

function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function recoveryHash(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`milkandhenny/recovery-code/v1:${normalizeRecoveryCode(value)}`)
    .digest("hex");
}

function safeHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function reserveAttempt(sessionId: string): Promise<boolean> {
  const key = `${RATE_PREFIX}${sha256(sessionId).slice(0, 32)}`;
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
      return count <= RATE_MAXIMUM;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === "production") return false;
  const now = Date.now();
  const current = developmentRates.get(key);
  const next =
    !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + RATE_WINDOW_SECONDS * 1_000 }
      : { count: current.count + 1, expiresAt: current.expiresAt };
  developmentRates.set(key, next);
  return next.count <= RATE_MAXIMUM;
}

function otp(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: SITE_NAME,
    label,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

function fresh(value: string | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= MANAGEMENT_STEP_UP_MS
  );
}

async function activeAuthenticator(personId: string): Promise<TotpRow | null> {
  return queryOne<TotpRow>(
    `select id::text,person_id::text,label,secret_ciphertext,last_counter,
            created_at,verified_at,last_used_at
       from person_totp_authenticators
      where person_id = $1 and verified_at is not null and revoked_at is null
      order by verified_at desc limit 1`,
    [personId],
  );
}

export async function personTotpStatus(personId: string): Promise<TotpStatus> {
  const authenticator = await activeAuthenticator(personId);
  if (!authenticator) return { enabled: false, recoveryCodesRemaining: 0 };
  const remaining = await queryOne<{ count: string }>(
    `select count(*)::text as count from person_recovery_codes
      where person_id = $1 and consumed_at is null`,
    [personId],
  );
  return {
    enabled: true,
    label: authenticator.label,
    createdAt: authenticator.created_at.toISOString(),
    lastUsedAt: authenticator.last_used_at?.toISOString(),
    recoveryCodesRemaining: Number(remaining?.count) || 0,
  };
}

export async function personHasTotp(personId: string): Promise<boolean> {
  return Boolean(await activeAuthenticator(personId));
}

export async function beginTotpEnrollment(): Promise<
  TotpResult<{ enrollmentId: string; secret: string; qrDataUrl: string }>
> {
  const session = await getAttendeeSession();
  if (!session?.personId || !fresh(session.authenticatedAt)) {
    return {
      ok: false,
      status: 428,
      code: "FRESH_SIGN_IN_REQUIRED",
      error: "Sign in again before setting up an authenticator app",
    };
  }
  const secretKey = authSecret();
  if (!secretKey) return { ok: false, status: 503, error: "MFA is not configured" };
  if (!(await reserveAttempt(session.id))) {
    return { ok: false, status: 429, error: "Too many MFA requests. Try again shortly." };
  }
  const person = await queryOne<{ label: string | null }>(
    `select coalesce(
              people.canonical_name,
              (select identifier.email_address
                 from event_person_identifiers identifier
                where identifier.person_id = people.id and identifier.kind = 'email'
                  and identifier.verified_at is not null and identifier.historical_until is null
                  and identifier.email_address is not null
                order by identifier.verified_at asc limit 1),
              'Account'
            ) as label
       from event_people people where people.id = $1`,
    [session.personId],
  );
  if (!person) return { ok: false, status: 404, error: "Account not found" };
  const label = person.label?.trim() || "Account";
  const secret = new Secret({ size: 20 }).base32;
  const authenticator = otp(secret, label);
  const uri = authenticator.toString();
  const row = await transaction(async (client) => {
    await client.query(
      `delete from person_totp_authenticators
        where person_id = $1 and verified_at is null`,
      [session.personId],
    );
    return (
      await client.query<{ id: string }>(
        `insert into person_totp_authenticators
           (person_id,label,secret_ciphertext,enrollment_session_hash,enrollment_expires_at)
         values ($1,$2,$3,$4,now() + interval '10 minutes') returning id::text`,
        [
          session.personId,
          "Authenticator app",
          encryptSecret(secret, secretKey),
          sha256(session.id),
        ],
      )
    ).rows[0];
  });
  if (!row) return { ok: false, status: 503, error: "MFA setup is unavailable" };
  const qrDataUrl = await QRCode.toDataURL(uri);
  return { ok: true, value: { enrollmentId: row.id, secret, qrDataUrl } };
}

function validateTotp(input: {
  token: string;
  secret: string;
  lastCounter: number | null;
}): number | null {
  if (!/^\d{6}$/.test(input.token)) return null;
  const authenticator = otp(input.secret, "account");
  const timestamp = Date.now();
  const currentCounter = authenticator.counter({ timestamp });
  const delta = authenticator.validate({
    token: input.token,
    timestamp,
    window: TOTP_WINDOW,
  });
  if (delta === null) return null;
  const acceptedCounter = currentCounter + delta;
  return input.lastCounter !== null && acceptedCounter <= input.lastCounter
    ? null
    : acceptedCounter;
}

async function completedEmailMfaIsStillValid(input: {
  personId: string;
  emailHash: string;
  authenticatorId?: string;
}): Promise<boolean> {
  const state = await queryOne<{ email_active: boolean; authenticator_active: boolean }>(
    `select
       exists (
         select 1 from event_person_identifiers
          where person_id = $1 and kind = 'email' and value_hash = $2
            and verified_at is not null and historical_until is null
       ) as email_active,
       exists (
         select 1 from person_totp_authenticators
          where person_id = $1 and verified_at is not null and revoked_at is null
            and ($3::uuid is null or id = $3)
       ) as authenticator_active`,
    [input.personId, input.emailHash, input.authenticatorId ?? null],
  );
  return state?.email_active === true && state.authenticator_active === true;
}

export async function finishTotpEnrollment(input: {
  enrollmentId: string;
  token: string;
}): Promise<TotpResult<{ recoveryCodes: string[] }>> {
  const session = await getAttendeeSession();
  const secretKey = authSecret();
  if (!session?.personId || !secretKey) return { ok: false, status: 401, error: "Sign in first" };
  if (!(await reserveAttempt(session.id)))
    return { ok: false, status: 429, error: "Too many attempts. Try again shortly." };
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
  const generationId = randomUUID();
  const result = await transaction(async (client) => {
    const selected = await client.query<TotpRow>(
      `select id::text,person_id::text,label,secret_ciphertext,last_counter,
              created_at,verified_at,last_used_at
         from person_totp_authenticators
        where id = $1 and person_id = $2 and verified_at is null and revoked_at is null
          and enrollment_session_hash = $3 and enrollment_expires_at > now()
        for update`,
      [input.enrollmentId, session.personId, sha256(session.id)],
    );
    const row = selected.rows[0];
    if (!row) return false;
    const acceptedCounter = validateTotp({
      token: input.token,
      secret: decryptSecret(row.secret_ciphertext, secretKey),
      lastCounter: null,
    });
    if (acceptedCounter === null) return false;
    await client.query(
      `update person_totp_authenticators
          set revoked_at = now()
        where person_id = $1 and verified_at is not null and revoked_at is null`,
      [session.personId],
    );
    await client.query(
      `update person_totp_authenticators
          set verified_at = now(),last_counter = $2,last_used_at = now(),
              enrollment_session_hash = null,enrollment_expires_at = null
        where id = $1`,
      [row.id, acceptedCounter],
    );
    await client.query(`delete from person_recovery_codes where person_id = $1`, [
      session.personId,
    ]);
    for (const code of codes) {
      await client.query(
        `insert into person_recovery_codes (person_id,generation_id,code_hash)
         values ($1,$2,$3)`,
        [session.personId, generationId, recoveryHash(code, secretKey)],
      );
    }
    return true;
  });
  if (!result) return { ok: false, status: 400, error: "That code is not valid" };
  await stepUpAttendeeSession({ factor: "totp", totpId: input.enrollmentId });
  await sendPersonSecurityNotice({
    personId: session.personId,
    subject: "Authenticator-app MFA was enabled",
    message: "Email sign-in now requires a code from your authenticator app or a recovery code.",
  });
  return { ok: true, value: { recoveryCodes: codes } };
}

export async function verifyPendingTotp(token: string): Promise<TotpResult<{ returnTo: string }>> {
  const session = await getAttendeeSession();
  const secretKey = authSecret();
  if (!session?.pendingMfa || !secretKey || !pendingMfaIsFresh(session.pendingMfa)) {
    return { ok: false, status: 401, error: "Start sign-in again" };
  }
  if (!(await reserveAttempt(session.id)))
    return { ok: false, status: 429, error: "Too many attempts. Try again shortly." };
  const authenticator = await activeAuthenticator(session.pendingMfa.personId);
  if (!authenticator) return { ok: false, status: 409, error: "Authenticator app is not enabled" };
  const accepted = await transaction(async (client) => {
    const selected = await client.query<TotpRow>(
      `select id::text,person_id::text,label,secret_ciphertext,last_counter,
              created_at,verified_at,last_used_at
         from person_totp_authenticators
        where id = $1 and verified_at is not null and revoked_at is null for update`,
      [authenticator.id],
    );
    const row = selected.rows[0];
    if (!row) return false;
    const lastCounter = row.last_counter === null ? null : Number(row.last_counter);
    const counter = validateTotp({
      token,
      secret: decryptSecret(row.secret_ciphertext, secretKey),
      lastCounter,
    });
    if (counter === null) return false;
    await client.query(
      `update person_totp_authenticators
          set last_counter = $2,last_used_at = now() where id = $1`,
      [row.id, counter],
    );
    return true;
  });
  if (!accepted) return { ok: false, status: 401, error: "That code is not valid" };
  const returnTo = session.pendingMfa.returnTo;
  const completed = await completeAttendeeMfaSession({
    factor: "totp",
    totpId: authenticator.id,
  });
  if (
    !completed?.personId ||
    !(await completedEmailMfaIsStillValid({
      personId: completed.personId,
      emailHash: session.pendingMfa.verifiedEmailHash,
      authenticatorId: authenticator.id,
    }))
  ) {
    if (completed?.personId) await revokeAttendeeSessionsForPerson(completed.personId);
    return { ok: false, status: 401, error: "Start sign-in again" };
  }
  return { ok: true, value: { returnTo } };
}

export async function verifyPendingRecoveryCode(
  code: string,
): Promise<TotpResult<{ returnTo: string; recoveryCodesRemaining: number }>> {
  const session = await getAttendeeSession();
  const secretKey = authSecret();
  if (!session?.pendingMfa || !secretKey || !pendingMfaIsFresh(session.pendingMfa)) {
    return { ok: false, status: 401, error: "Start sign-in again" };
  }
  if (!(await reserveAttempt(session.id)))
    return { ok: false, status: 429, error: "Too many attempts. Try again shortly." };
  const normalized = normalizeRecoveryCode(code);
  if (!/^[A-Z2-9]{12}$/.test(normalized)) {
    return { ok: false, status: 401, error: "That recovery code is not valid" };
  }
  const wanted = recoveryHash(normalized, secretKey);
  const used = await transaction(async (client) => {
    const candidates = await client.query<{ id: string; code_hash: string }>(
      `select id::text,code_hash from person_recovery_codes
        where person_id = $1 and consumed_at is null for update`,
      [session.pendingMfa!.personId],
    );
    const matching = candidates.rows.find((candidate) =>
      safeHashEquals(candidate.code_hash, wanted),
    );
    if (!matching) return null;
    await client.query(`update person_recovery_codes set consumed_at = now() where id = $1`, [
      matching.id,
    ]);
    const remaining = await client.query<{ count: string }>(
      `select count(*)::text as count from person_recovery_codes
        where person_id = $1 and consumed_at is null`,
      [session.pendingMfa!.personId],
    );
    return Number(remaining.rows[0]?.count) || 0;
  });
  if (used === null) return { ok: false, status: 401, error: "That recovery code is not valid" };
  const returnTo = session.pendingMfa.returnTo;
  const completed = await completeAttendeeMfaSession({ factor: "recovery-code" });
  if (
    !completed?.personId ||
    !(await completedEmailMfaIsStillValid({
      personId: completed.personId,
      emailHash: session.pendingMfa.verifiedEmailHash,
    }))
  ) {
    if (completed?.personId) await revokeAttendeeSessionsForPerson(completed.personId);
    return { ok: false, status: 401, error: "Start sign-in again" };
  }
  await sendPersonSecurityNotice({
    personId: session.pendingMfa.personId,
    subject: "A recovery code was used",
    message: `A recovery code completed a sign-in. ${used} recovery codes remain.`,
  });
  return { ok: true, value: { returnTo, recoveryCodesRemaining: used } };
}

export async function disableTotp(): Promise<TotpResult<{ disabled: true }>> {
  const session = await getAttendeeSession();
  if (!session?.personId) return { ok: false, status: 401, error: "Sign in first" };
  if (!fresh(session.passkeyAuthenticatedAt) && !fresh(session.totpAuthenticatedAt)) {
    return {
      ok: false,
      status: 428,
      code: "STEP_UP_REQUIRED",
      error: "Use your passkey or authenticator app again before disabling MFA",
    };
  }
  await transaction(async (client) => {
    await client.query(
      `update person_totp_authenticators set revoked_at = now()
        where person_id = $1 and revoked_at is null`,
      [session.personId],
    );
    await client.query(`delete from person_recovery_codes where person_id = $1`, [
      session.personId,
    ]);
  });
  await sendPersonSecurityNotice({
    personId: session.personId,
    subject: "Authenticator-app MFA was disabled",
    message:
      "Authenticator-app MFA and its recovery codes were removed. All sessions were signed out.",
  });
  await revokeAttendeeSessionsForPerson(session.personId);
  return { ok: true, value: { disabled: true } };
}

export async function regenerateRecoveryCodes(): Promise<TotpResult<{ recoveryCodes: string[] }>> {
  const session = await getAttendeeSession();
  const secretKey = authSecret();
  if (!session?.personId || !secretKey) {
    return { ok: false, status: 401, error: "Sign in first" };
  }
  if (!fresh(session.passkeyAuthenticatedAt) && !fresh(session.totpAuthenticatedAt)) {
    return {
      ok: false,
      status: 428,
      code: "STEP_UP_REQUIRED",
      error: "Use your passkey or authenticator app again before replacing recovery codes",
    };
  }
  if (!(await reserveAttempt(session.id))) {
    return { ok: false, status: 429, error: "Too many MFA requests. Try again shortly." };
  }
  if (!(await activeAuthenticator(session.personId))) {
    return { ok: false, status: 409, error: "Authenticator app is not enabled" };
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
  const generationId = randomUUID();
  await transaction(async (client) => {
    await client.query(`delete from person_recovery_codes where person_id = $1`, [
      session.personId,
    ]);
    for (const code of codes) {
      await client.query(
        `insert into person_recovery_codes (person_id,generation_id,code_hash)
         values ($1,$2,$3)`,
        [session.personId, generationId, recoveryHash(code, secretKey)],
      );
    }
  });
  await sendPersonSecurityNotice({
    personId: session.personId,
    subject: "Recovery codes were replaced",
    message: "New recovery codes were generated. Every older recovery code is now invalid.",
  });
  return { ok: true, value: { recoveryCodes: codes } };
}
