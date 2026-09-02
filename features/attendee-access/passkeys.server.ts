import { createHash, randomBytes } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";

import {
  authenticateAttendeeSession,
  ensureAttendeeSession,
  getAttendeeSession,
  revokeAttendeeSessionsForPerson,
} from "@/features/attendee-access/session.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getRedis } from "@/lib/platform/redis.server";
import { getBaseUrlForRequest, SITE_NAME } from "@/lib/shared/config";
import { requestFingerprint } from "./access.server";
import { safeReturnTo } from "./types";
import { sendPersonSecurityNotice } from "./security-notifications.server";

const CEREMONY_TTL_SECONDS = 5 * 60;
const MANAGEMENT_STEP_UP_MS = 10 * 60 * 1_000;
const CEREMONY_PREFIX = "attendee-passkey:ceremony:v1:";
const RATE_PREFIX = "attendee-passkey:rate:v1:";
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_MAXIMUM = 30;
const IP_RATE_MAXIMUM = 120;
const GLOBAL_RATE_MAXIMUM = 600;

export type PasskeyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; code?: string };

export type PasskeySummary = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  backedUp: boolean;
  deviceType: "singleDevice" | "multiDevice";
};

type Ceremony = {
  type: "registration" | "authentication";
  challenge: string;
  sessionHash: string;
  origin: string;
  rpId: string;
  personId?: string;
  returnTo?: string;
};

type PasskeyRow = {
  id: string;
  person_id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string | number;
  transports: AuthenticatorTransportFuture[];
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  label: string;
  created_at: Date;
  last_used_at: Date | null;
  user_handle?: string;
};

const developmentCeremonies = new Map<string, { value: Ceremony; expiresAt: number }>();
const developmentRates = new Map<string, { count: number; expiresAt: number }>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ceremonyId(): string {
  return randomBytes(18).toString("base64url");
}

function ceremonyConfig(request: Request): { origin: string; rpId: string } {
  const origin = getBaseUrlForRequest(request);
  return { origin, rpId: new URL(origin).hostname };
}

async function reserveRateLimit(discriminator: string, maximum = RATE_MAXIMUM): Promise<boolean> {
  const key = `${RATE_PREFIX}${sha256(discriminator).slice(0, 32)}`;
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS);
      return count <= maximum;
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
  return next.count <= maximum;
}

async function storeCeremony(id: string, value: Ceremony): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${CEREMONY_PREFIX}${id}`, value, { ex: CEREMONY_TTL_SECONDS });
      return true;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === "production") return false;
  developmentCeremonies.set(id, {
    value,
    expiresAt: Date.now() + CEREMONY_TTL_SECONDS * 1_000,
  });
  return true;
}

function parseCeremony(value: unknown): Ceremony | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Partial<Ceremony>;
  if (
    (record.type !== "registration" && record.type !== "authentication") ||
    typeof record.challenge !== "string" ||
    typeof record.sessionHash !== "string" ||
    typeof record.origin !== "string" ||
    typeof record.rpId !== "string"
  ) {
    return null;
  }
  return record as Ceremony;
}

async function takeCeremony(id: string): Promise<Ceremony | null> {
  if (!/^[A-Za-z0-9_-]{24}$/.test(id)) return null;
  const key = `${CEREMONY_PREFIX}${id}`;
  const redis = getRedis();
  if (redis) {
    try {
      return parseCeremony(await redis.getdel(key));
    } catch {
      return null;
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  const current = developmentCeremonies.get(id);
  developmentCeremonies.delete(id);
  return current && current.expiresAt > Date.now() ? current.value : null;
}

async function activePasskeyRows(personId: string): Promise<PasskeyRow[]> {
  return query<PasskeyRow>(
    `select id::text,person_id::text,credential_id,public_key,counter,transports,
            device_type,backed_up,label,created_at,last_used_at
       from person_passkeys
      where person_id = $1 and revoked_at is null
      order by created_at desc`,
    [personId],
  );
}

function summary(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
    backedUp: row.backed_up,
    deviceType: row.device_type,
  };
}

function managementProofIsFresh(value: string | undefined): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= MANAGEMENT_STEP_UP_MS
  );
}

async function canManagePasskeys(personId: string): Promise<PasskeyResult<true>> {
  const session = await getAttendeeSession();
  if (!session || session.personId !== personId)
    return { ok: false, status: 401, error: "Sign in first" };
  const existing = await activePasskeyRows(personId);
  const proof = existing.length > 0 ? session.passkeyAuthenticatedAt : session.authenticatedAt;
  if (!managementProofIsFresh(proof)) {
    return {
      ok: false,
      status: 428,
      code: existing.length > 0 ? "PASSKEY_STEP_UP_REQUIRED" : "FRESH_SIGN_IN_REQUIRED",
      error:
        existing.length > 0
          ? "Use an existing passkey before changing passkeys"
          : "Sign in again before adding a passkey",
    };
  }
  return { ok: true, value: true };
}

export async function listPersonPasskeys(personId: string): Promise<PasskeySummary[]> {
  return (await activePasskeyRows(personId)).map(summary);
}

export async function beginPasskeyRegistration(
  request: Request,
): Promise<PasskeyResult<{ ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON }>> {
  const session = await ensureAttendeeSession();
  if (!session.personId) return { ok: false, status: 401, error: "Sign in first" };
  if (!(await reserveRateLimit(session.id)))
    return { ok: false, status: 429, error: "Too many passkey requests. Try again shortly." };
  const allowed = await canManagePasskeys(session.personId);
  if (!allowed.ok) return allowed;

  const person = await queryOne<{ canonical_name: string | null }>(
    `select canonical_name from event_people where id = $1`,
    [session.personId],
  );
  if (!person) return { ok: false, status: 404, error: "Account not found" };
  const existing = await activePasskeyRows(session.personId);
  let profile = await queryOne<{ user_handle: string }>(
    `select user_handle from person_webauthn_profiles where person_id = $1`,
    [session.personId],
  );
  if (!profile) {
    profile = await queryOne<{ user_handle: string }>(
      `insert into person_webauthn_profiles (person_id,user_handle)
       values ($1,$2) on conflict (person_id) do update set person_id = excluded.person_id
       returning user_handle`,
      [session.personId, randomBytes(32).toString("base64url")],
    );
  }
  if (!profile) return { ok: false, status: 503, error: "Passkey setup is unavailable" };

  const config = ceremonyConfig(request);
  const options = await generateRegistrationOptions({
    rpName: SITE_NAME,
    rpID: config.rpId,
    userID: Buffer.from(profile.user_handle, "base64url"),
    userName: profile.user_handle,
    userDisplayName: person.canonical_name ?? "Milk & Henny account",
    attestationType: "none",
    timeout: CEREMONY_TTL_SECONDS * 1_000,
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credential_id,
      transports: passkey.transports,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const id = ceremonyId();
  if (
    !(await storeCeremony(id, {
      type: "registration",
      challenge: options.challenge,
      sessionHash: sha256(session.id),
      personId: session.personId,
      ...config,
    }))
  ) {
    return { ok: false, status: 503, error: "Passkey setup is temporarily unavailable" };
  }
  return { ok: true, value: { ceremonyId: id, options } };
}

export async function finishPasskeyRegistration(input: {
  ceremonyId: string;
  response: RegistrationResponseJSON;
  label: string;
}): Promise<PasskeyResult<{ passkey: PasskeySummary }>> {
  const session = await getAttendeeSession();
  if (!session?.personId) return { ok: false, status: 401, error: "Sign in first" };
  const ceremony = await takeCeremony(input.ceremonyId);
  if (
    !ceremony ||
    ceremony.type !== "registration" ||
    ceremony.personId !== session.personId ||
    ceremony.sessionHash !== sha256(session.id)
  ) {
    return { ok: false, status: 400, error: "That passkey setup expired. Start again." };
  }
  const label = input.label.trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > 80)
    return { ok: false, status: 400, error: "Name this passkey using 1 to 80 characters" };

  try {
    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      requireUserVerification: true,
    });
    if (!verification.verified)
      return { ok: false, status: 400, error: "The passkey could not be verified" };
    const credential = verification.registrationInfo.credential;
    const row = await queryOne<PasskeyRow>(
      `insert into person_passkeys
         (person_id,credential_id,public_key,counter,transports,device_type,backed_up,label)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (credential_id) do nothing
       returning id::text,person_id::text,credential_id,public_key,counter,transports,
                 device_type,backed_up,label,created_at,last_used_at`,
      [
        session.personId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports ?? [],
        verification.registrationInfo.credentialDeviceType,
        verification.registrationInfo.credentialBackedUp,
        label,
      ],
    );
    if (!row) return { ok: false, status: 409, error: "That passkey is already registered" };
    await authenticateAttendeeSession({
      personId: session.personId,
      method: "passkey",
      passkeyId: row.id,
    });
    await sendPersonSecurityNotice({
      personId: session.personId,
      subject: "A passkey was added",
      message: `The passkey “${label}” was added to your account.`,
    });
    return { ok: true, value: { passkey: summary(row) } };
  } catch {
    return { ok: false, status: 400, error: "The passkey response was not valid" };
  }
}

export async function beginPasskeyAuthentication(
  request: Request,
  returnTo?: string,
): Promise<PasskeyResult<{ ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }>> {
  const [globallyAllowed, addressAllowed] = await Promise.all([
    reserveRateLimit("authentication:global", GLOBAL_RATE_MAXIMUM),
    reserveRateLimit(`authentication:ip:${requestFingerprint(request)}`, IP_RATE_MAXIMUM),
  ]);
  if (!globallyAllowed || !addressAllowed) {
    return { ok: false, status: 429, error: "Too many passkey requests. Try again shortly." };
  }
  const session = await ensureAttendeeSession();
  if (!(await reserveRateLimit(`authentication:session:${session.id}`)))
    return { ok: false, status: 429, error: "Too many passkey requests. Try again shortly." };
  const config = ceremonyConfig(request);
  const options = await generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: "required",
    timeout: CEREMONY_TTL_SECONDS * 1_000,
  });
  const id = ceremonyId();
  if (
    !(await storeCeremony(id, {
      type: "authentication",
      challenge: options.challenge,
      sessionHash: sha256(session.id),
      returnTo: safeReturnTo(returnTo),
      ...config,
    }))
  ) {
    return { ok: false, status: 503, error: "Passkey sign-in is temporarily unavailable" };
  }
  return { ok: true, value: { ceremonyId: id, options } };
}

export async function finishPasskeyAuthentication(input: {
  ceremonyId: string;
  response: AuthenticationResponseJSON;
}): Promise<PasskeyResult<{ returnTo: string }>> {
  const session = await getAttendeeSession();
  if (!session) return { ok: false, status: 400, error: "Start passkey sign-in again" };
  const ceremony = await takeCeremony(input.ceremonyId);
  if (
    !ceremony ||
    ceremony.type !== "authentication" ||
    ceremony.sessionHash !== sha256(session.id)
  ) {
    return { ok: false, status: 400, error: "That passkey request expired. Start again." };
  }
  try {
    const passkey = await transaction(async (client) => {
      const selected = await client.query<PasskeyRow>(
        `select passkey.id::text,passkey.person_id::text,passkey.credential_id,
                passkey.public_key,passkey.counter,passkey.transports,passkey.device_type,
                passkey.backed_up,passkey.label,passkey.created_at,passkey.last_used_at,
                profile.user_handle
           from person_passkeys passkey
           join person_webauthn_profiles profile on profile.person_id = passkey.person_id
          where passkey.credential_id = $1 and passkey.revoked_at is null
          for update of passkey`,
        [input.response.id],
      );
      const row = selected.rows[0];
      if (!row || !row.user_handle || input.response.response.userHandle !== row.user_handle) {
        return null;
      }
      const credential: WebAuthnCredential = {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.counter),
        transports: row.transports,
      };
      const verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: ceremony.challenge,
        expectedOrigin: ceremony.origin,
        expectedRPID: ceremony.rpId,
        credential,
        requireUserVerification: true,
      });
      if (!verification.verified) return null;
      await client.query(
        `update person_passkeys
            set counter = $2,device_type = $3,backed_up = $4,last_used_at = now()
          where id = $1 and revoked_at is null`,
        [
          row.id,
          verification.authenticationInfo.newCounter,
          verification.authenticationInfo.credentialDeviceType,
          verification.authenticationInfo.credentialBackedUp,
        ],
      );
      return row;
    });
    if (!passkey)
      return { ok: false, status: 401, error: "That passkey is not recognised or valid" };
    await authenticateAttendeeSession({
      personId: passkey.person_id,
      method: "passkey",
      passkeyId: passkey.id,
    });
    const stillActive = await queryOne<{ id: string }>(
      `select id::text from person_passkeys
        where id = $1 and person_id = $2 and revoked_at is null`,
      [passkey.id, passkey.person_id],
    );
    if (!stillActive) {
      await revokeAttendeeSessionsForPerson(passkey.person_id);
      return { ok: false, status: 401, error: "That passkey is no longer active" };
    }
    return { ok: true, value: { returnTo: ceremony.returnTo ?? "/my" } };
  } catch {
    return { ok: false, status: 401, error: "The passkey response was not valid" };
  }
}

export async function revokePersonPasskey(input: {
  personId: string;
  passkeyId: string;
}): Promise<PasskeyResult<{ revoked: true }>> {
  const allowed = await canManagePasskeys(input.personId);
  if (!allowed.ok) return allowed;
  const revoked = await transaction(async (client): Promise<PasskeyResult<PasskeyRow>> => {
    const selected = await client.query<PasskeyRow>(
      `select id::text,person_id::text,credential_id,public_key,counter,transports,
              device_type,backed_up,label,created_at,last_used_at
         from person_passkeys
        where person_id = $1 and revoked_at is null
        order by created_at for update`,
      [input.personId],
    );
    const target = selected.rows.find((passkey) => passkey.id === input.passkeyId);
    if (!target) return { ok: false, status: 404, error: "Passkey not found" };
    if (selected.rows.length === 1) {
      const admin = await client.query<{ id: string }>(
        `select id from global_admin_grants
          where person_id = $1 and status = 'active'
            and starts_at <= now() and (expires_at is null or expires_at > now())
          limit 1`,
        [input.personId],
      );
      if (admin.rows[0]) {
        return {
          ok: false,
          status: 409,
          error: "Add another passkey before removing an administrator’s last passkey",
        };
      }
    }
    await client.query(`update person_passkeys set revoked_at = now() where id = $1`, [target.id]);
    return { ok: true, value: target };
  });
  if (!revoked.ok) return revoked;
  await sendPersonSecurityNotice({
    personId: input.personId,
    subject: "A passkey was removed",
    message: `The passkey “${revoked.value.label}” was removed from your account. All sessions were signed out.`,
  });
  await revokeAttendeeSessionsForPerson(input.personId);
  return { ok: true, value: { revoked: true } };
}

export async function renamePersonPasskey(input: {
  personId: string;
  passkeyId: string;
  label: string;
}): Promise<PasskeyResult<{ passkey: PasskeySummary }>> {
  const allowed = await canManagePasskeys(input.personId);
  if (!allowed.ok) return allowed;
  const label = input.label.trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > 80)
    return { ok: false, status: 400, error: "Name this passkey using 1 to 80 characters" };
  const row = await queryOne<PasskeyRow>(
    `update person_passkeys set label = $3
      where id = $1 and person_id = $2 and revoked_at is null
      returning id::text,person_id::text,credential_id,public_key,counter,transports,
                device_type,backed_up,label,created_at,last_used_at`,
    [input.passkeyId, input.personId, label],
  );
  return row
    ? { ok: true, value: { passkey: summary(row) } }
    : { ok: false, status: 404, error: "Passkey not found" };
}
