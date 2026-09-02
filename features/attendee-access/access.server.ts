import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { PoolClient } from "pg";

import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { getRedis } from "@/lib/platform/redis.server";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { describeEmailCapability, sendEmail } from "@/lib/platform/email.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import { generateTicketId, hashEmail as hashTicketEmail } from "@/features/tickets/qr.server";
import { ticketOperationsForPerson } from "@/features/attendee-operations/ticket-operations.server";
import { removePersonEmail } from "@/features/attendee-operations/identity-manager.server";
import { personGameHistory, personGameStats } from "@/features/person-games/history.server";
import { connectPitchDecksToVerifiedPerson } from "@/features/things/pitches/identity.server";
import { listPitchDecksForPerson } from "@/features/things/pitches/store.server";
import { achievementCabinetForPerson } from "@/features/achievements/achievements.server";
import { listAccountCredits } from "@/features/credits/credits.server";
import { safeReturnTo, type AttendeeAccount, type AttendeeTicketIdentity } from "./types";

const CHALLENGE_LIFETIME_MS = 15 * 60 * 1_000;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const EMAIL_RATE_LIMIT = 5;
const IP_RATE_LIMIT = 20;
const MAX_CODE_ATTEMPTS = 6;
const EMAIL_IDENTITY_STEP_UP_MS = 10 * 60 * 1_000;
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOGIN_RATE_PREFIX = "attendee-access:rate:v1:";

const developmentRateLimits = new Map<string, { count: number; expiresAt: number }>();

export type AccessResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type ChallengeRow = {
  id: string;
  email: string;
  email_hash: string;
  token_hash: string;
  code_hash: string;
  purpose: "sign-in" | "add-email";
  person_id_hint: string | null;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_person_id: string | null;
  consumed_session_hash: string | null;
  return_to: string;
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function credentialSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function codeHash(code: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`milkandhenny/attendee-code/v1:${code.trim().toUpperCase()}`)
    .digest("hex");
}

function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function accessCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export function requestFingerprint(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwarded?.at(-1) ||
    "unknown";
  return sha256(address).slice(0, 32);
}

async function reserveRateLimit(key: string, maximum: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(`${LOGIN_RATE_PREFIX}${key}`);
      if (count === 1) await redis.expire(`${LOGIN_RATE_PREFIX}${key}`, RATE_LIMIT_WINDOW_SECONDS);
      return count <= maximum;
    } catch {
      return false;
    }
  }
  if (process.env.NODE_ENV === "production") return false;
  const now = Date.now();
  const current = developmentRateLimits.get(key);
  const next =
    !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_SECONDS * 1_000 }
      : { ...current, count: current.count + 1 };
  developmentRateLimits.set(key, next);
  return next.count <= maximum;
}

function accessEmail(input: {
  email: string;
  origin: string;
  challengeId: string;
  token: string;
  code: string;
}) {
  const link = buildAppUrl(input.origin, "/access/verify", {
    fragment: { challenge: input.challengeId, token: input.token },
  });
  const text = [
    "Your milk & henny sign-in",
    "",
    `Continue: ${link}`,
    "",
    `Or enter this code: ${input.code}`,
    "",
    "This expires in 15 minutes and works once. If you did not request it, ignore this email.",
    "",
    "— milk & henny",
  ].join("\n");
  const html = renderBrandedEmail({
    origin: input.origin,
    label: "your sign-in",
    title: "Pick up where you left off",
    contentHtml: `<p style="margin:0">Use this private, one-time link to see your tickets and scores on this device.</p><p style="margin:18px 0 0">Or enter <strong style="font:600 20px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em">${escapeEmailHtml(input.code)}</strong></p>`,
    action: { label: "continue securely", url: link },
    note: "This expires in 15 minutes and works once. If you did not request it, you can ignore this email.",
  });
  return { link, text, html };
}

export async function requestAttendeeAccess(input: {
  email: string;
  origin: string;
  ipFingerprint: string;
  returnTo?: string;
  purpose?: "sign-in" | "add-email";
  authenticatedPersonId?: string;
  authenticatedAt?: string;
}): Promise<AccessResult<{ sent: true }>> {
  if (!isValidEmail(input.email))
    return { ok: false, status: 400, error: "That email address doesn’t look right" };
  const secret = credentialSecret();
  if (!secret) return { ok: false, status: 503, error: "Email access is not configured" };
  if (!describeEmailCapability().senders.access) {
    return { ok: false, status: 503, error: "Email access is temporarily unavailable" };
  }
  const email = normaliseEmail(input.email);
  const emailHash = sha256(email);
  const [emailAllowed, ipAllowed] = await Promise.all([
    reserveRateLimit(`email:${emailHash}`, EMAIL_RATE_LIMIT),
    reserveRateLimit(`ip:${input.ipFingerprint}`, IP_RATE_LIMIT),
  ]);
  if (!emailAllowed || !ipAllowed)
    return { ok: false, status: 429, error: "Too many requests. Try again shortly." };

  const purpose = input.purpose ?? "sign-in";
  if (purpose === "add-email" && !input.authenticatedPersonId)
    return { ok: false, status: 401, error: "Sign in before adding an email" };
  if (purpose === "add-email" && attendeeEmailStepUpRequired(input.authenticatedAt)) {
    return {
      ok: false,
      status: 403,
      error: "Sign in again with an existing email before adding another",
    };
  }

  const challengeId = id("access");
  const token = randomBytes(32).toString("base64url");
  const code = accessCode();
  const expiresAt = new Date(Date.now() + CHALLENGE_LIFETIME_MS);
  await transaction(async (client) => {
    await client.query(
      `update event_person_login_challenges
          set consumed_at = now()
        where email_hash = $1 and consumed_at is null`,
      [emailHash],
    );
    // A new credential replaces the old one. Cancel its still-pending email
    // too, so a recovered provider cannot later deliver several dead links.
    await client.query(
      `update email_outbox
          set status = 'cancelled',message = null,cancelled_at = now(),updated_at = now()
        where recipient_hash = $1 and kind = 'attendee-access'
          and status = 'pending' and cancelled_at is null`,
      [emailHash],
    );
    await client.query(
      `insert into event_person_login_challenges
         (id,email,email_hash,token_hash,code_hash,purpose,person_id_hint,return_to,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        challengeId,
        email,
        emailHash,
        sha256(token),
        codeHash(code, secret),
        purpose,
        purpose === "add-email" ? input.authenticatedPersonId : null,
        safeReturnTo(input.returnTo),
        expiresAt,
      ],
    );
  });

  const rendered = accessEmail({ email, origin: input.origin, challengeId, token, code });
  const sent = await sendEmail(
    {
      channel: "access",
      to: email,
      subject: "Your milk & henny sign-in",
      text: rendered.text,
      html: rendered.html,
    },
    {
      idempotencyKey: `attendee-access:${challengeId}`,
      kind: "attendee-access",
      source: "self-service",
      contentExpiresAt: expiresAt,
    },
  );
  if (!sent.ok) {
    await query(`delete from event_person_login_challenges where id = $1 and consumed_at is null`, [
      challengeId,
    ]).catch(() => undefined);
    return { ok: false, status: 503, error: "The access email could not be queued" };
  }
  return { ok: true, value: { sent: true } };
}

export function attendeeEmailStepUpRequired(
  authenticatedAt: string | undefined,
  now = Date.now(),
): boolean {
  if (!authenticatedAt) return true;
  const authenticatedTime = Date.parse(authenticatedAt);
  const age = now - authenticatedTime;
  return !Number.isFinite(authenticatedTime) || age < 0 || age > EMAIL_IDENTITY_STEP_UP_MS;
}

async function resolvePerson(
  client: PoolClient,
  challenge: ChallengeRow,
): Promise<AccessResult<{ personId: string; identifierId: string }>> {
  const existing = await client.query<{
    id: string;
    person_id: string;
    historical_until: Date | null;
  }>(
    `select id, person_id, historical_until from event_person_identifiers
      where kind = 'email' and value_hash = $1 for update`,
    [challenge.email_hash],
  );
  const identifier = existing.rows[0];
  if (identifier) {
    if (challenge.person_id_hint && identifier.person_id !== challenge.person_id_hint) {
      return {
        ok: false,
        status: 409,
        error: "That email is already connected to another person",
      };
    }
    if (identifier.historical_until && !challenge.person_id_hint) {
      return {
        ok: false,
        status: 403,
        error: "That email is no longer connected to an account",
      };
    }
    await client.query(
      `update event_person_identifiers
          set verified_at = coalesce(verified_at, now()), historical_until = null,
              display_hint = $2,email_address = $3
        where id = $1`,
      [identifier.id, maskedEmail(challenge.email), challenge.email],
    );
    return { ok: true, value: { personId: identifier.person_id, identifierId: identifier.id } };
  }

  const createdPerson = challenge.person_id_hint
    ? null
    : await client.query<{ id: string }>(`insert into event_people default values returning id`);
  const personId = challenge.person_id_hint ?? createdPerson?.rows[0]?.id;
  if (!personId) throw new Error("Person could not be created");
  const inserted = await client.query<{ id: string }>(
    `insert into event_person_identifiers
       (person_id,kind,value_hash,verified_at,display_hint,email_address)
     values ($1,'email',$2,now(),$3,$4)
     on conflict (kind, value_hash) do nothing
     returning id`,
    [personId, challenge.email_hash, maskedEmail(challenge.email), challenge.email],
  );
  if (!inserted.rows[0]) {
    if (!challenge.person_id_hint) {
      await client.query(`delete from event_people where id = $1`, [personId]);
    }
    const raced = await client.query<{
      id: string;
      person_id: string;
      historical_until: Date | null;
    }>(
      `select id, person_id, historical_until from event_person_identifiers
        where kind = 'email' and value_hash = $1`,
      [challenge.email_hash],
    );
    const row = raced.rows[0];
    if (!row || (challenge.person_id_hint && row.person_id !== challenge.person_id_hint)) {
      return {
        ok: false,
        status: 409,
        error: "That email is already connected to another person",
      };
    }
    if (row.historical_until && !challenge.person_id_hint) {
      return {
        ok: false,
        status: 403,
        error: "That email is no longer connected to an account",
      };
    }
    if (row.historical_until) {
      await client.query(
        `update event_person_identifiers
            set verified_at = now(), historical_until = null, display_hint = $2,
                email_address = $3
          where id = $1`,
        [row.id, maskedEmail(challenge.email), challenge.email],
      );
    }
    return { ok: true, value: { personId: row.person_id, identifierId: row.id } };
  }
  return { ok: true, value: { personId, identifierId: inserted.rows[0]!.id } };
}

async function grantPurchaserOrders(
  client: PoolClient,
  input: { personId: string; identifierId: string; emailHash: string },
): Promise<void> {
  await client.query(
    `insert into event_order_managers
       (id,event_slug,order_id,person_id,identifier_id,role,source)
     select
       'ordmgr_' || substr(md5(t.order_id || $1::text || random()::text), 1, 24),
       t.event_slug, t.order_id, $1::uuid, $2::uuid, 'owner', 'verified-purchaser-email'
       from tickets t
      where t.email_hash = $3
      group by t.event_slug, t.order_id
     on conflict (order_id, person_id) where status = 'active' do nothing`,
    [input.personId, input.identifierId, input.emailHash],
  );
}

export async function verifyAttendeeAccess(input: {
  sessionId: string;
  ipFingerprint: string;
  challengeId?: string;
  token?: string;
  email?: string;
  code?: string;
}): Promise<
  AccessResult<{
    personId: string;
    emailHash: string;
    returnTo: string;
    purpose: "sign-in" | "add-email";
  }>
> {
  const secret = credentialSecret();
  if (!secret) return { ok: false, status: 503, error: "Email access is not configured" };
  if (!(await reserveRateLimit(`verify:${input.ipFingerprint}`, IP_RATE_LIMIT)))
    return { ok: false, status: 429, error: "Too many attempts. Try again shortly." };
  const byLink = Boolean(input.challengeId && input.token);
  const byCode = Boolean(input.email && input.code && isValidEmail(input.email));
  if (!byLink && !byCode)
    return { ok: false, status: 400, error: "Enter the email and code, or use the email link" };
  const sessionHash = sha256(input.sessionId);
  const suppliedEmailHash = byCode ? sha256(normaliseEmail(input.email!)) : null;

  return transaction(async (client) => {
    const selected = byLink
      ? await client.query<ChallengeRow>(
          `select * from event_person_login_challenges where id = $1 for update`,
          [input.challengeId],
        )
      : await client.query<ChallengeRow>(
          `select * from event_person_login_challenges
            where email_hash = $1
            order by created_at desc limit 1 for update`,
          [suppliedEmailHash],
        );
    const challenge = selected.rows[0];
    if (!challenge)
      return { ok: false, status: 400, error: "That access link or code is not valid" };
    if (challenge.consumed_at) {
      return challenge.consumed_person_id && challenge.consumed_session_hash === sessionHash
        ? {
            ok: true,
            value: {
              personId: challenge.consumed_person_id,
              emailHash: challenge.email_hash,
              returnTo: challenge.return_to,
              purpose: challenge.purpose,
            },
          }
        : { ok: false, status: 409, error: "That access link or code has already been used" };
    }
    if (challenge.expires_at.getTime() <= Date.now())
      return { ok: false, status: 410, error: "That access link or code has expired" };
    if (challenge.attempts >= MAX_CODE_ATTEMPTS)
      return { ok: false, status: 429, error: "Too many attempts. Request a new email." };

    const suppliedHash = byLink ? sha256(input.token!) : codeHash(input.code!, secret);
    const expectedHash = byLink ? challenge.token_hash : challenge.code_hash;
    if (!safeEquals(expectedHash, suppliedHash)) {
      await client.query(
        `update event_person_login_challenges set attempts = attempts + 1 where id = $1`,
        [challenge.id],
      );
      return { ok: false, status: 400, error: "That access link or code is not valid" };
    }

    const resolved = await resolvePerson(client, challenge);
    if (!resolved.ok) return resolved;
    await grantPurchaserOrders(client, {
      personId: resolved.value.personId,
      identifierId: resolved.value.identifierId,
      emailHash: hashTicketEmail(challenge.email),
    });
    await connectPitchDecksToVerifiedPerson(client, {
      personId: resolved.value.personId,
      emailHash: challenge.email_hash,
    });
    await client.query(
      `update event_person_login_challenges
          set consumed_at = now(), consumed_person_id = $2, consumed_session_hash = $3
        where id = $1`,
      [challenge.id, resolved.value.personId, sessionHash],
    );
    return {
      ok: true,
      value: {
        personId: resolved.value.personId,
        emailHash: challenge.email_hash,
        returnTo: challenge.return_to,
        purpose: challenge.purpose,
      },
    };
  });
}

export async function inspectAttendeeAccessLink(input: {
  challengeId?: string;
  token?: string;
}): Promise<{ available: boolean; issue?: "invalid" | "expired" | "used" }> {
  if (!input.challengeId || !input.token) return { available: false, issue: "invalid" };
  const challenge = await queryOne<{
    token_hash: string;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `select token_hash,expires_at,consumed_at
       from event_person_login_challenges where id = $1`,
    [input.challengeId],
  );
  if (!challenge || !safeEquals(challenge.token_hash, sha256(input.token))) {
    return { available: false, issue: "invalid" };
  }
  if (challenge.consumed_at) return { available: false, issue: "used" };
  if (challenge.expires_at.getTime() <= Date.now()) {
    return { available: false, issue: "expired" };
  }
  return { available: true };
}

export async function claimTicketForPerson(input: {
  personId: string;
  verifiedEmailHash: string;
  ticketId: string;
  permittedParticipantId: string;
}): Promise<AccessResult<{ claimed: true; participantId: string; publicTicketId: string }>> {
  return transaction(async (client) => {
    const identifier = await client.query<{ id: string }>(
      `select id from event_person_identifiers
        where person_id = $1 and kind = 'email' and value_hash = $2 and verified_at is not null`,
      [input.personId, input.verifiedEmailHash],
    );
    const identifierId = identifier.rows[0]?.id;
    if (!identifierId) return { ok: false, status: 401, error: "Verify your email again" };
    const selected = await client.query<{
      participant_id: string;
      event_slug: string;
      holder_name: string;
      ticket_status: string;
      person_id: string | null;
      access_reference: string | null;
    }>(
      `select p.id as participant_id, p.event_slug, p.person_id,
              t.holder_name, t.status as ticket_status,t.access_reference
         from event_participants p
         join tickets t on t.id = p.ticket_id
        where t.id = $1
        for update of p`,
      [input.ticketId],
    );
    const row = selected.rows[0];
    if (!row || row.participant_id !== input.permittedParticipantId)
      return { ok: false, status: 403, error: "Open this ticket link on this device first" };
    if (row.ticket_status !== "valid")
      return { ok: false, status: 409, error: "That ticket is no longer claimable" };
    if (row.person_id && row.person_id !== input.personId)
      return { ok: false, status: 409, error: "That ticket is already claimed by someone else" };
    const existingClaim = await client.query<{ person_id: string }>(
      `select person_id from event_ticket_identity_claims
        where ticket_id = $1 and status = 'active' for update`,
      [input.ticketId],
    );
    if (existingClaim.rows[0]?.person_id && existingClaim.rows[0].person_id !== input.personId) {
      return { ok: false, status: 409, error: "That ticket is already claimed by someone else" };
    }
    if (!row.person_id) {
      await client.query(
        `update event_participants set person_id = $2, updated_at = now() where id = $1`,
        [row.participant_id, input.personId],
      );
      await client.query(
        `update event_people
            set canonical_name = coalesce(canonical_name, $2), updated_at = now()
          where id = $1`,
        [input.personId, row.holder_name],
      );
    }
    const claimInserted = existingClaim.rows[0]
      ? null
      : await client.query<{ id: string }>(
          `insert into event_ticket_identity_claims
         (id,event_slug,ticket_id,participant_id,person_id,identifier_id,source)
       values ($1,$2,$3,$4,$5,$6,'ticket-and-email')
       on conflict (ticket_id) where status = 'active' do nothing
       returning id`,
          [
            id("ticketclaim"),
            row.event_slug,
            input.ticketId,
            row.participant_id,
            input.personId,
            identifierId,
          ],
        );
    if (claimInserted?.rows[0]) {
      await client.query(
        `insert into score_audit_events
           (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
         values ($1,'identity.ticket.claimed','attendee',$2,'participant',$3,$4::jsonb)`,
        [
          row.event_slug,
          input.personId,
          row.participant_id,
          JSON.stringify({ ticketId: input.ticketId, source: "ticket-and-email" }),
        ],
      );
    }
    const publicTicketId = claimInserted?.rows[0]
      ? generateTicketId()
      : (row.access_reference ?? input.ticketId);
    if (claimInserted?.rows[0]) {
      await client.query(
        `update tickets
            set access_reference = $2,authority_version = authority_version + 1
          where id = $1`,
        [input.ticketId, publicTicketId],
      );
    }
    return {
      ok: true,
      value: { claimed: true, participantId: row.participant_id, publicTicketId },
    };
  });
}

export async function releaseOwnTicketClaim(input: {
  personId: string;
  ticketId: string;
}): Promise<AccessResult<{ released: true }>> {
  return transaction(async (client) => {
    const selected = await client.query<{
      participant_id: string;
      event_slug: string;
      redeemed_at: Date | null;
    }>(
      `select p.id as participant_id, p.event_slug, t.redeemed_at
         from event_participants p
         join tickets t on t.id = p.ticket_id
         join event_ticket_identity_claims c
           on c.ticket_id = t.id and c.person_id = p.person_id and c.status = 'active'
        where t.id = $1 and p.person_id = $2 for update of p`,
      [input.ticketId, input.personId],
    );
    const row = selected.rows[0];
    if (!row) return { ok: false, status: 404, error: "That ticket is not claimed by you" };
    const postings = await client.query(
      `select 1 from score_postings where participant_id = $1 limit 1`,
      [row.participant_id],
    );
    if (row.redeemed_at || postings.rowCount)
      return {
        ok: false,
        status: 409,
        error: "This claim has event activity. Contact us so its history stays correct.",
      };
    await client.query(
      `update event_ticket_identity_claims
          set status = 'released', released_at = now(), release_reason = 'attendee-correction'
        where ticket_id = $1 and person_id = $2 and status = 'active'`,
      [input.ticketId, input.personId],
    );
    await client.query(
      `update event_participants set person_id = null, updated_at = now() where id = $1`,
      [row.participant_id],
    );
    await client.query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,entity_type,entity_id,metadata)
       values ($1,'identity.ticket.released','attendee',$2,'participant',$3,$4::jsonb)`,
      [
        row.event_slug,
        input.personId,
        row.participant_id,
        JSON.stringify({ ticketId: input.ticketId, reason: "attendee-correction" }),
      ],
    );
    return { ok: true, value: { released: true } };
  });
}

export async function managedOrderIdsForPerson(personId: string): Promise<string[]> {
  const rows = await query<{ order_id: string }>(
    `select order_id from event_order_managers
      where person_id = $1 and status = 'active' order by created_at desc`,
    [personId],
  );
  return rows.map((row) => row.order_id);
}

function maskedEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${local.length > 1 ? "•••" : ""}@${domain}`;
}

export async function attendeeAccount(personId: string): Promise<AttendeeAccount | null> {
  const person = await queryOne<{ id: string; canonical_name: string | null }>(
    `select id, canonical_name from event_people where id = $1`,
    [personId],
  );
  if (!person) return null;
  const [
    emails,
    pitches,
    tickets,
    ticketOperations,
    globalAccess,
    eventAccess,
    gameHistory,
    gameStats,
    achievements,
    credits,
  ] = await Promise.all([
    query<{ id: string; display_hint: string; verified_at: Date }>(
      `select id,coalesce(display_hint, 'verified email') as display_hint, verified_at
         from event_person_identifiers
        where person_id = $1 and kind = 'email' and verified_at is not null
        order by verified_at desc`,
      [personId],
    ),
    listPitchDecksForPerson(personId),
    query<{
      id: string;
      access_reference: string | null;
      order_id: string;
      event_slug: string;
      event_title: string;
      starts_at: Date;
      holder_name: string;
      status: string;
      points: number;
      order_points: number | null;
      public_alias: string | null;
      team_name: string | null;
      team_colour_key: import("@/features/event-scoring/team-palette").TeamColourKey | null;
      rank: string | null;
      participant_id: string | null;
      personally_claimed: boolean;
      manages_order: boolean;
    }>(
      `select distinct on (t.id)
          t.id, t.access_reference, t.order_id, t.event_slug, e.title as event_title, e.starts_at,
          t.holder_name, t.status, p.id as participant_id,
          coalesce(sp.balance, 0)::integer as points,
          case when om.id is not null then (
            select coalesce(sum(order_projection.balance), 0)::integer
              from tickets order_ticket
              join event_participants order_participant on order_participant.ticket_id = order_ticket.id
             left join score_projections order_projection
                on order_projection.participant_id = order_participant.id
             where order_ticket.order_id = t.order_id
               and order_ticket.event_slug = t.event_slug
               and order_ticket.status = 'valid'
               and order_participant.status = 'active'
          ) else null end as order_points,
          coalesce(p.chosen_alias,p.generated_alias) as public_alias,
          team.name as team_name, team.colour_key as team_colour_key,
          case when p.id is null then null else (
            1 + (select count(*) from score_projections ranked
                  join event_participants ranked_participant
                    on ranked_participant.id = ranked.participant_id
                 where ranked_participant.event_slug = t.event_slug
                   and ranked_participant.status = 'active'
                   and ranked.balance > coalesce(sp.balance, 0))
          )::text end as rank,
          (p.person_id = $1) as personally_claimed,
          (om.id is not null) as manages_order
         from tickets t
         join events e on e.slug = t.event_slug
         left join event_participants p on p.ticket_id = t.id
         left join score_projections sp on sp.participant_id = p.id
         left join lateral (
           select score_teams.name, score_teams.colour_key
             from score_team_memberships membership
             join score_teams on score_teams.id = membership.team_id
            where membership.participant_id = p.id
              and membership.starts_at <= now()
              and (membership.ends_at is null or membership.ends_at > now())
            order by membership.starts_at desc limit 1
         ) team on true
         left join event_order_managers om
           on om.order_id = t.order_id and om.person_id = $1 and om.status = 'active'
        where p.person_id = $1 or om.id is not null
        order by t.id, t.issued_at desc`,
      [personId],
    ),
    ticketOperationsForPerson(personId),
    query<{ role_preset: string; status: string; expires_at: Date | null }>(
      `select role_preset,status,expires_at from global_admin_grants
        where person_id = $1 and status in ('pending','active','paused')
        order by created_at desc`,
      [personId],
    ),
    query<{
      event_slug: string;
      label: string;
      status: string;
      invitation_state: string;
      expires_at: Date | null;
    }>(
      `select event_slug,label,status,invitation_state,expires_at from score_staff_assignments
        where person_id = $1 and status in ('active','paused')
        order by created_at desc`,
      [personId],
    ),
    personGameHistory(personId),
    personGameStats(personId),
    achievementCabinetForPerson(personId),
    listAccountCredits(personId),
  ]);
  const participantIds = tickets
    .map((ticket) => ticket.participant_id)
    .filter((participantId): participantId is string => Boolean(participantId));
  const historyRows = participantIds.length
    ? await query<{
        participant_id: string;
        points: number;
        reason_code: string;
        created_at: Date;
      }>(
        `select posting.participant_id,posting.points,score.reason_code,score.created_at
           from score_postings posting
           join score_transactions score on score.id = posting.transaction_id
          where posting.participant_id = any($1::text[])
            and score.status = 'accepted'
          order by score.created_at desc limit 200`,
        [participantIds],
      )
    : [];
  return {
    name: person.canonical_name,
    pitches,
    gameHistory,
    gameStats,
    achievements,
    credits,
    emails: emails.map((row) => ({
      id: row.id,
      masked: row.display_hint,
      verifiedAt: row.verified_at.toISOString(),
    })),
    tickets: tickets.map((row) => ({
      id: row.id,
      publicId: row.access_reference ?? row.id,
      orderId: row.order_id,
      eventSlug: row.event_slug,
      eventTitle: row.event_title,
      holderName: row.holder_name,
      status: row.status,
      startsAt: row.starts_at.toISOString(),
      points: row.points,
      orderPoints: row.order_points ?? undefined,
      rank: row.rank ? Number(row.rank) : undefined,
      publicAlias: row.public_alias ?? undefined,
      teamName: row.team_name ?? undefined,
      teamColourKey: row.team_colour_key ?? undefined,
      scoreHistory: historyRows
        .filter((history) => history.participant_id === row.participant_id)
        .map((history) => ({
          points: history.points,
          reason: history.reason_code,
          createdAt: history.created_at.toISOString(),
        })),
      personallyClaimed: row.personally_claimed,
      managesOrder: row.manages_order,
    })),
    ticketOperations,
    access: [
      ...globalAccess.map((grant) => ({
        kind: "global" as const,
        label: grant.role_preset,
        status: grant.status,
        expiresAt: grant.expires_at?.toISOString(),
        href: grant.status === "active" ? "/admin" : undefined,
      })),
      ...eventAccess.map((assignment) => ({
        kind: "event" as const,
        label: assignment.label,
        eventSlug: assignment.event_slug,
        status: assignment.status === "active" ? assignment.invitation_state : assignment.status,
        expiresAt: assignment.expires_at?.toISOString(),
        href:
          assignment.status === "active" && assignment.invitation_state === "active"
            ? `/events/${encodeURIComponent(assignment.event_slug)}/staff/personal`
            : undefined,
      })),
    ],
  };
}

export async function attendeeAccountExists(personId: string): Promise<boolean> {
  return Boolean(
    await queryOne<{ id: string }>("select id from event_people where id = $1", [personId]),
  );
}

export async function updateAttendeeName(
  personId: string,
  name: string,
): Promise<AccessResult<{ name: string }>> {
  const normalized = name.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 120)
    return { ok: false, status: 400, error: "Enter a name between 1 and 120 characters" };
  const row = await queryOne<{ canonical_name: string }>(
    `update event_people set canonical_name = $2, updated_at = now()
      where id = $1 returning canonical_name`,
    [personId, normalized],
  );
  return row
    ? { ok: true, value: { name: row.canonical_name } }
    : { ok: false, status: 404, error: "Person not found" };
}

export async function attendeePreferredName(personId: string): Promise<string | null> {
  const person = await queryOne<{ canonical_name: string | null }>(
    "select canonical_name from event_people where id = $1",
    [personId],
  );
  return person?.canonical_name ?? null;
}

export async function removeAttendeeEmail(input: {
  personId: string;
  identifierId: string;
  authenticatedAt?: string;
}): Promise<AccessResult<{ removed: true; revokedSessions: number }>> {
  if (attendeeEmailStepUpRequired(input.authenticatedAt)) {
    return {
      ok: false,
      status: 403,
      error: "Sign in again with an existing email before removing one",
    };
  }

  const result = await removePersonEmail({
    personId: input.personId,
    identifierId: input.identifierId,
    actorId: input.personId,
    actorType: "attendee",
    reason: "self-service email removal",
  });
  if (result.ok) {
    const { sendPersonSecurityNotice } = await import("./security-notifications.server");
    await sendPersonSecurityNotice({
      personId: input.personId,
      subject: "A sign-in email was removed",
      message:
        "A verified email address was removed from your account. All sessions were signed out.",
    });
  }
  return result;
}

/**
 * Returns an active verified address for an attendee. Prefer the address that authenticated the
 * current session; passkey sessions deliberately fall back to the most recently verified address.
 */
export async function attendeeEmailAddress(
  personId: string,
  preferredEmailHash?: string,
): Promise<string | undefined> {
  const identifier = await queryOne<{ email_address: string }>(
    `select email_address
       from event_person_identifiers
      where person_id = $1 and kind = 'email' and verified_at is not null
        and historical_until is null and email_address is not null
      order by case when value_hash = $2 then 0 else 1 end, verified_at desc
      limit 1`,
    [personId, preferredEmailHash ?? null],
  );
  if (!identifier) return undefined;
  const email = normaliseEmail(identifier.email_address);
  return isValidEmail(email) ? email : undefined;
}

export async function currentAttendeeEmailAddress(): Promise<string | undefined> {
  const session = await getAttendeeSession();
  if (!session?.personId) return undefined;
  return attendeeEmailAddress(session.personId, session.verifiedEmailHash);
}

export async function currentAttendeeAccountView(): Promise<{
  account: AttendeeAccount | null;
  emailStepUpRequired: boolean;
}> {
  const session = await getAttendeeSession();
  if (!session?.personId) return { account: null, emailStepUpRequired: true };
  return {
    account: await attendeeAccount(session.personId),
    emailStepUpRequired: attendeeEmailStepUpRequired(session.authenticatedAt),
  };
}

export async function currentAttendeeAccountStatus(): Promise<boolean> {
  const session = await getAttendeeSession();
  return session?.personId ? attendeeAccountExists(session.personId) : false;
}

export async function currentAttendeeTicketIdentity(
  ticketId: string,
  eventSlug: string,
): Promise<AttendeeTicketIdentity> {
  const session = await getAttendeeSession();
  if (!session?.personId) {
    return { account: null, personallyClaimed: false };
  }

  const [person, claimedTickets] = await Promise.all([
    queryOne<{ canonical_name: string | null }>(
      "select canonical_name from event_people where id = $1",
      [session.personId],
    ),
    query<{ id: string; holder_name: string }>(
      `select t.id,t.holder_name
         from event_participants p
         join tickets t on t.id = p.ticket_id
        where p.person_id = $1 and p.event_slug = $2 and p.status = 'active'
        order by p.created_at asc,p.id asc`,
      [session.personId, eventSlug],
    ),
  ]);
  if (!person) return { account: null, personallyClaimed: false };

  const personallyClaimed = claimedTickets.some((ticket) => ticket.id === ticketId);
  const anotherClaimedTicket = claimedTickets.find((ticket) => ticket.id !== ticketId);
  return {
    account: { name: person.canonical_name },
    personallyClaimed,
    ...(anotherClaimedTicket ? { anotherClaimedTicketName: anotherClaimedTicket.holder_name } : {}),
  };
}

export async function cleanupExpiredAccessChallenges(): Promise<{ deleted: number }> {
  const rows = await query<{ deleted: string }>(
    `with removed as (
       delete from event_person_login_challenges
        where expires_at < now() - interval '1 day'
        returning id
     )
     select count(*)::text as deleted from removed`,
  );
  return { deleted: Number(rows[0]?.deleted) || 0 };
}

export const __attendeeAccessTesting = {
  accessCode,
  codeHash,
  safeReturnTo,
  sha256,
};
