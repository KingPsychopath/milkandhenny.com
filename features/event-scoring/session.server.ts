import { randomBytes, randomInt } from "node:crypto";

import { getCookie, setCookie } from "@tanstack/react-start/server";

import { getRedis } from "@/lib/platform/redis.server";
import { query } from "@/lib/platform/postgres.server";
import { log } from "@/lib/platform/logger.server";
import { getCookie as getRequestCookie } from "@/lib/http/cookies";
import { getEvent } from "@/features/events/store.server";
import { getTicket } from "@/features/tickets/store.server";
import { participantForTicket } from "./store.server";
import { ATTENDEE_SESSION_COOKIE_NAME } from "./session-cookie";

const SESSION_PREFIX = "event-scoring:attendee-session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;
const SESSION_ROTATION_MS = 1000 * 60 * 60 * 24 * 7;
const ATTENDEE_SESSION_SCHEMA_VERSION = 1;
const PENDING_MFA_LIFETIME_MS = 10 * 60 * 1_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_LOCK_PREFIX = "event-scoring:attendee-session-lock:";
const SESSION_LOCK_TTL_MS = 5_000;
const SESSION_LOCK_ATTEMPTS = 12;
const RELEASE_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type AttendeeTicketAccess = {
  ticketId: string;
  eventSlug: string;
  eventId: string;
  participantId: string;
  mode: "scoring" | "view-only";
  addedAt: string;
};

export type AttendeeSession = {
  schemaVersion: typeof ATTENDEE_SESSION_SCHEMA_VERSION;
  id: string;
  tickets: AttendeeTicketAccess[];
  activeParticipantByEventId: Record<string, string>;
  personId?: string;
  verifiedEmailHash?: string;
  authenticatedAt?: string;
  authenticationMethod?: "email" | "passkey";
  passkeyAuthenticatedAt?: string;
  passkeyId?: string;
  totpAuthenticatedAt?: string;
  totpId?: string;
  assurance?: {
    primary: "email" | "passkey";
    factors: Array<"email" | "passkey" | "totp" | "recovery-code">;
    phishingResistant: boolean;
    authenticatedAt: string;
    steppedUpAt?: string;
  };
  pendingMfa?: {
    personId: string;
    verifiedEmailHash: string;
    returnTo: string;
    createdAt: string;
  };
  createdAt: string;
  lastSeenAt: string;
};

export type PersonAttendeeSessionSummary = {
  activeSessions: number;
  lastSeenAt?: string;
  authenticatedAt?: string;
};

export function pendingMfaIsFresh(
  pendingMfa: AttendeeSession["pendingMfa"],
  now = Date.now(),
): boolean {
  if (!pendingMfa) return false;
  const createdAt = Date.parse(pendingMfa.createdAt);
  return (
    Number.isFinite(createdAt) && createdAt <= now && now - createdAt <= PENDING_MFA_LIFETIME_MS
  );
}

const developmentSessions = new Map<string, AttendeeSession>();
const developmentSessionLocks = new Map<string, Promise<void>>();

function allowMemoryFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

function sessionId(): string {
  return randomBytes(24).toString("base64url");
}

function readSessionId(): string | null {
  const value = getCookie(ATTENDEE_SESSION_COOKIE_NAME);
  return typeof value === "string" && SESSION_ID_PATTERN.test(value) ? value : null;
}

function setSessionCookie(id: string): void {
  setCookie(ATTENDEE_SESSION_COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

function withoutIdentity(session: AttendeeSession): AttendeeSession {
  const {
    personId: _personId,
    verifiedEmailHash: _email,
    authenticatedAt: _authenticatedAt,
    authenticationMethod: _authenticationMethod,
    passkeyAuthenticatedAt: _passkeyAuthenticatedAt,
    passkeyId: _passkeyId,
    totpAuthenticatedAt: _totpAuthenticatedAt,
    totpId: _totpId,
    assurance: _assurance,
    pendingMfa: _pendingMfa,
    ...anonymous
  } = session;
  return { ...anonymous, schemaVersion: ATTENDEE_SESSION_SCHEMA_VERSION };
}

function parseStored(value: unknown): AttendeeSession | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Partial<AttendeeSession>;
  if (
    typeof candidate.id !== "string" ||
    !Array.isArray(candidate.tickets) ||
    !candidate.activeParticipantByEventId ||
    typeof candidate.activeParticipantByEventId !== "object"
  ) {
    return null;
  }
  return candidate as AttendeeSession;
}

type SessionRead = {
  session: AttendeeSession;
  identityInvalidated: boolean;
};

async function legacyPersonExists(personId: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    "select exists(select 1 from event_people where id = $1) as exists",
    [personId],
  );
  return rows[0]?.exists === true;
}

async function normalizeStoredSession(session: AttendeeSession): Promise<{
  session: AttendeeSession;
  changed: boolean;
  identityInvalidated: boolean;
}> {
  const legacySchema = session.schemaVersion !== ATTENDEE_SESSION_SCHEMA_VERSION;
  const existence = new Map<string, boolean>();
  const validLegacyPerson = async (personId: string): Promise<boolean> => {
    if (!isUuidV7(personId)) return false;
    if (!legacySchema) return true;
    const cached = existence.get(personId);
    if (cached !== undefined) return cached;
    const exists = await legacyPersonExists(personId);
    existence.set(personId, exists);
    return exists;
  };

  const invalidPersonId = Boolean(session.personId && !(await validLegacyPerson(session.personId)));
  const invalidPendingPersonId = Boolean(
    session.pendingMfa && !(await validLegacyPerson(session.pendingMfa.personId)),
  );
  if (invalidPersonId) {
    log.warn("event-scoring.session", "Invalidated a legacy attendee identity");
    return { session: withoutIdentity(session), changed: true, identityInvalidated: true };
  }
  if (invalidPendingPersonId) {
    const { pendingMfa: _pendingMfa, ...withoutPendingMfa } = session;
    log.warn("event-scoring.session", "Invalidated a legacy pending MFA identity");
    return {
      session: {
        ...withoutPendingMfa,
        schemaVersion: ATTENDEE_SESSION_SCHEMA_VERSION,
      },
      changed: true,
      identityInvalidated: true,
    };
  }
  if (legacySchema)
    return {
      session: { ...session, schemaVersion: ATTENDEE_SESSION_SCHEMA_VERSION },
      changed: true,
      identityInvalidated: false,
    };
  return { session, changed: false, identityInvalidated: false };
}

async function readById(id: string): Promise<SessionRead | null> {
  const redis = getRedis();
  const parsed = redis
    ? parseStored(await redis.get(`${SESSION_PREFIX}${id}`))
    : allowMemoryFallback()
      ? (developmentSessions.get(id) ?? null)
      : null;
  if (!parsed) return null;
  const normalized = await normalizeStoredSession(parsed);
  if (normalized.changed) await write(normalized.session);
  return { session: normalized.session, identityInvalidated: normalized.identityInvalidated };
}

async function storedSessions(): Promise<AttendeeSession[]> {
  const redis = getRedis();
  if (redis) {
    const sessions: AttendeeSession[] = [];
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        match: `${SESSION_PREFIX}*`,
        count: 100,
      });
      cursor = nextCursor;
      if (keys.length === 0) continue;
      const pipeline = redis.pipeline();
      for (const key of keys) pipeline.get(key);
      const values = await pipeline.exec();
      for (const value of values) {
        const session = parseStored(value);
        if (session) sessions.push(session);
      }
    } while (cursor !== "0");
    return sessions;
  }
  if (!allowMemoryFallback()) throw new Error("Attendee session persistence is unavailable");
  return [...developmentSessions.values()];
}

export async function attendeeSessionSummaries(
  personIds: readonly string[],
): Promise<Map<string, PersonAttendeeSessionSummary>> {
  const wanted = new Set(personIds);
  const summaries = new Map<string, PersonAttendeeSessionSummary>();
  if (wanted.size === 0) return summaries;
  for (const session of await storedSessions()) {
    if (!session.personId || !wanted.has(session.personId)) continue;
    const current = summaries.get(session.personId);
    const lastSeenAt =
      !current?.lastSeenAt || Date.parse(session.lastSeenAt) > Date.parse(current.lastSeenAt)
        ? session.lastSeenAt
        : current.lastSeenAt;
    const authenticatedAt =
      session.authenticatedAt &&
      (!current?.authenticatedAt ||
        Date.parse(session.authenticatedAt) > Date.parse(current.authenticatedAt))
        ? session.authenticatedAt
        : current?.authenticatedAt;
    summaries.set(session.personId, {
      activeSessions: (current?.activeSessions ?? 0) + 1,
      lastSeenAt,
      authenticatedAt,
    });
  }
  return summaries;
}

export async function revokeAttendeeSessionsForPerson(personId: string): Promise<number> {
  const sessions = (await storedSessions()).filter(
    (session) => session.personId === personId || session.pendingMfa?.personId === personId,
  );
  if (sessions.length === 0) return 0;
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    for (const session of sessions) pipeline.del(`${SESSION_PREFIX}${session.id}`);
    await pipeline.exec();
  } else if (allowMemoryFallback()) {
    for (const session of sessions) developmentSessions.delete(session.id);
  } else {
    throw new Error("Attendee session persistence is unavailable");
  }
  return sessions.length;
}

async function write(session: AttendeeSession): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(`${SESSION_PREFIX}${session.id}`, session, { ex: SESSION_TTL_SECONDS });
    return;
  }
  if (!allowMemoryFallback()) throw new Error("Attendee session persistence is unavailable");
  developmentSessions.set(session.id, session);
}

async function refresh(session: AttendeeSession): Promise<AttendeeSession> {
  const touched = { ...session, lastSeenAt: new Date().toISOString() };
  const redis = getRedis();
  if (redis) await redis.expire(`${SESSION_PREFIX}${session.id}`, SESSION_TTL_SECONDS);
  setSessionCookie(touched.id);
  return touched;
}

async function withSessionMutation<T>(id: string, use: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    const owner = randomBytes(18).toString("base64url");
    const key = `${SESSION_LOCK_PREFIX}${id}`;
    let acquired = false;
    for (let attempt = 0; attempt < SESSION_LOCK_ATTEMPTS; attempt += 1) {
      acquired = Boolean(await redis.set(key, owner, { nx: true, px: SESSION_LOCK_TTL_MS }));
      if (acquired) break;
      await new Promise((resolve) => setTimeout(resolve, 20 + randomInt(20)));
    }
    if (!acquired) throw new Error("Attendee session is busy");
    try {
      return await use();
    } finally {
      await redis.eval(RELEASE_LOCK_SCRIPT, [key], [owner]);
    }
  }

  if (!allowMemoryFallback()) throw new Error("Attendee session persistence is unavailable");
  const previous = developmentSessionLocks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  developmentSessionLocks.set(id, tail);
  await previous;
  try {
    return await use();
  } finally {
    release();
    if (developmentSessionLocks.get(id) === tail) developmentSessionLocks.delete(id);
  }
}

async function loadOrCreate(): Promise<AttendeeSession> {
  const existingId = readSessionId();
  const existing = existingId ? await readById(existingId) : null;
  if (existing?.identityInvalidated)
    return rotateSession(existing.session, {
      personId: existing.session.personId,
      verifiedEmailHash: existing.session.verifiedEmailHash,
      authenticatedAt: existing.session.authenticatedAt,
      authenticationMethod: existing.session.authenticationMethod,
      passkeyAuthenticatedAt: existing.session.passkeyAuthenticatedAt,
      passkeyId: existing.session.passkeyId,
      totpAuthenticatedAt: existing.session.totpAuthenticatedAt,
      totpId: existing.session.totpId,
      assurance: existing.session.assurance,
      pendingMfa: existing.session.pendingMfa,
    });
  if (existing) return refresh(existing.session);
  const now = new Date().toISOString();
  const created = {
    schemaVersion: ATTENDEE_SESSION_SCHEMA_VERSION,
    id: sessionId(),
    tickets: [],
    activeParticipantByEventId: {},
    createdAt: now,
    lastSeenAt: now,
  } satisfies AttendeeSession;
  await write(created);
  setSessionCookie(created.id);
  return created;
}

export async function ensureAttendeeSession(): Promise<AttendeeSession> {
  return loadOrCreate();
}

async function rotateSession(
  session: AttendeeSession,
  changes: Pick<
    AttendeeSession,
    | "personId"
    | "verifiedEmailHash"
    | "authenticatedAt"
    | "authenticationMethod"
    | "passkeyAuthenticatedAt"
    | "passkeyId"
    | "totpAuthenticatedAt"
    | "totpId"
    | "assurance"
    | "pendingMfa"
  >,
): Promise<AttendeeSession> {
  return withSessionMutation(session.id, async () => {
    const current = (await readById(session.id))?.session ?? session;
    const now = new Date().toISOString();
    const rotated = {
      ...current,
      ...changes,
      id: sessionId(),
      createdAt: now,
      lastSeenAt: now,
    } satisfies AttendeeSession;
    await write(rotated);
    const redis = getRedis();
    if (redis) await redis.del(`${SESSION_PREFIX}${session.id}`);
    else if (allowMemoryFallback()) developmentSessions.delete(session.id);
    setSessionCookie(rotated.id);
    return rotated;
  });
}

export async function authenticateAttendeeSession(input: {
  personId: string;
  verifiedEmailHash?: string;
  method?: "email" | "passkey";
  passkeyId?: string;
}): Promise<AttendeeSession> {
  if (!isUuidV7(input.personId)) throw new Error("Attendee person ID must be UUIDv7");
  const session = await loadOrCreate();
  const now = new Date().toISOString();
  const method = input.method ?? "email";
  return rotateSession(session, {
    personId: input.personId,
    verifiedEmailHash: input.verifiedEmailHash,
    authenticatedAt: now,
    authenticationMethod: method,
    passkeyAuthenticatedAt: method === "passkey" ? now : undefined,
    passkeyId: method === "passkey" ? input.passkeyId : undefined,
    totpAuthenticatedAt: undefined,
    totpId: undefined,
    assurance: {
      primary: method,
      factors: [method],
      phishingResistant: method === "passkey",
      authenticatedAt: now,
      steppedUpAt: method === "passkey" ? now : undefined,
    },
    pendingMfa: undefined,
  });
}

export async function beginAttendeeMfaSession(input: {
  personId: string;
  verifiedEmailHash: string;
  returnTo: string;
}): Promise<AttendeeSession> {
  if (!isUuidV7(input.personId)) throw new Error("Attendee person ID must be UUIDv7");
  const session = await loadOrCreate();
  return rotateSession(session, {
    personId: undefined,
    verifiedEmailHash: undefined,
    authenticatedAt: undefined,
    authenticationMethod: undefined,
    passkeyAuthenticatedAt: undefined,
    passkeyId: undefined,
    totpAuthenticatedAt: undefined,
    totpId: undefined,
    assurance: undefined,
    pendingMfa: {
      personId: input.personId,
      verifiedEmailHash: input.verifiedEmailHash,
      returnTo: input.returnTo,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function completeAttendeeMfaSession(input: {
  factor: "totp" | "recovery-code";
  totpId?: string;
}): Promise<AttendeeSession | null> {
  const session = await getAttendeeSession();
  if (!session?.pendingMfa || !pendingMfaIsFresh(session.pendingMfa)) return null;
  const now = new Date().toISOString();
  return rotateSession(session, {
    personId: session.pendingMfa.personId,
    verifiedEmailHash: session.pendingMfa.verifiedEmailHash,
    authenticatedAt: now,
    authenticationMethod: "email",
    passkeyAuthenticatedAt: undefined,
    passkeyId: undefined,
    totpAuthenticatedAt: now,
    totpId: input.totpId,
    assurance: {
      primary: "email",
      factors: ["email", input.factor],
      phishingResistant: false,
      authenticatedAt: now,
      steppedUpAt: now,
    },
    pendingMfa: undefined,
  });
}

export async function stepUpAttendeeSession(input: {
  factor: "totp";
  totpId: string;
}): Promise<AttendeeSession | null> {
  const session = await getAttendeeSession();
  if (!session?.personId || !session.authenticatedAt) return null;
  const now = new Date().toISOString();
  const primary = session.authenticationMethod ?? "email";
  return rotateSession(session, {
    personId: session.personId,
    verifiedEmailHash: session.verifiedEmailHash,
    authenticatedAt: session.authenticatedAt,
    authenticationMethod: primary,
    passkeyAuthenticatedAt: session.passkeyAuthenticatedAt,
    passkeyId: session.passkeyId,
    totpAuthenticatedAt: now,
    totpId: input.totpId,
    assurance: {
      primary,
      factors: Array.from(new Set([...(session.assurance?.factors ?? [primary]), input.factor])),
      phishingResistant: session.assurance?.phishingResistant ?? primary === "passkey",
      authenticatedAt: session.assurance?.authenticatedAt ?? session.authenticatedAt,
      steppedUpAt: now,
    },
    pendingMfa: undefined,
  });
}

export async function signOutAttendeeSession(): Promise<AttendeeSession | null> {
  const session = await getAttendeeSession();
  if (!session) return null;
  const anonymous = withoutIdentity(session);
  return rotateSession(anonymous, {
    personId: undefined,
    verifiedEmailHash: undefined,
    authenticatedAt: undefined,
    authenticationMethod: undefined,
    passkeyAuthenticatedAt: undefined,
    passkeyId: undefined,
    totpAuthenticatedAt: undefined,
    totpId: undefined,
    assurance: undefined,
    pendingMfa: undefined,
  });
}

export async function getAttendeeSession(): Promise<AttendeeSession | null> {
  const id = readSessionId();
  if (!id) return null;
  const read = await readById(id);
  if (!read) return null;
  const { session } = read;
  if (read.identityInvalidated)
    return rotateSession(session, {
      personId: session.personId,
      verifiedEmailHash: session.verifiedEmailHash,
      authenticatedAt: session.authenticatedAt,
      authenticationMethod: session.authenticationMethod,
      passkeyAuthenticatedAt: session.passkeyAuthenticatedAt,
      passkeyId: session.passkeyId,
      totpAuthenticatedAt: session.totpAuthenticatedAt,
      totpId: session.totpId,
      assurance: session.assurance,
      pendingMfa: session.pendingMfa,
    });
  if (Date.now() - Date.parse(session.createdAt) >= SESSION_ROTATION_MS) {
    return rotateSession(session, {
      personId: session.personId,
      verifiedEmailHash: session.verifiedEmailHash,
      authenticatedAt: session.authenticatedAt,
      authenticationMethod: session.authenticationMethod,
      passkeyAuthenticatedAt: session.passkeyAuthenticatedAt,
      passkeyId: session.passkeyId,
      totpAuthenticatedAt: session.totpAuthenticatedAt,
      totpId: session.totpId,
      assurance: session.assurance,
      pendingMfa: session.pendingMfa,
    });
  }
  return refresh(session);
}

/** Read identity for an explicit HTTP request without relying on Start context. */
export async function getAttendeeSessionForRequest(
  request: Request,
): Promise<AttendeeSession | null> {
  const id = getRequestCookie(request, ATTENDEE_SESSION_COOKIE_NAME);
  if (!id || !SESSION_ID_PATTERN.test(id)) return null;
  return (await readById(id))?.session ?? null;
}

export async function openAttendeeTicket(input: {
  ticketId: string;
  eventSlug: string;
  mode: AttendeeTicketAccess["mode"];
}): Promise<{ session: AttendeeSession; ticket: AttendeeTicketAccess } | null> {
  const ticket = await getTicket(input.ticketId);
  if (!ticket || ticket.eventSlug !== input.eventSlug || ticket.status !== "valid") return null;
  const event = await getEvent(input.eventSlug);
  if (!event?.eventId) return null;
  const eventId = event.eventId;
  const participant = await participantForTicket(ticket.id);
  if (!participant || participant.eventSlug !== input.eventSlug) return null;
  const initial = await loadOrCreate();
  return withSessionMutation(initial.id, async () => {
    const session = (await readById(initial.id))?.session ?? initial;
    const existing = session.tickets.find((entry) => entry.ticketId === input.ticketId);
    const access: AttendeeTicketAccess = {
      ticketId: ticket.id,
      eventSlug: input.eventSlug,
      eventId,
      participantId: participant.id,
      mode: existing && input.mode === "view-only" ? existing.mode : input.mode,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    let tickets = session.tickets.some((entry) => entry.ticketId === access.ticketId)
      ? session.tickets.map((entry) =>
          entry.ticketId === access.ticketId ? { ...entry, mode: access.mode } : entry,
        )
      : [...session.tickets, access];
    const activeParticipantByEventId = { ...session.activeParticipantByEventId };
    if (access.mode === "scoring") {
      tickets = tickets.map((entry) =>
        entry.eventId === eventId && entry.ticketId !== access.ticketId
          ? { ...entry, mode: "view-only" as const }
          : entry,
      );
      activeParticipantByEventId[eventId] = participant.id;
    } else if (activeParticipantByEventId[eventId] === participant.id) {
      delete activeParticipantByEventId[eventId];
    }
    const updated = {
      ...session,
      tickets,
      activeParticipantByEventId,
      lastSeenAt: new Date().toISOString(),
    } satisfies AttendeeSession;
    await write(updated);
    setSessionCookie(updated.id);
    return { session: updated, ticket: access };
  });
}

export async function activeParticipantForEvent(eventSlug: string): Promise<string | undefined> {
  const [session, event] = await Promise.all([getAttendeeSession(), getEvent(eventSlug)]);
  if (!session || !event?.eventId) return undefined;
  const explicitlyActive = session.activeParticipantByEventId[event.eventId];
  if (explicitlyActive) return explicitlyActive;
  if (!session.personId) return undefined;
  const linked = await query<{ id: string }>(
    `select id from event_participants
      where event_slug = $1 and person_id = $2 and status = 'active'
      order by created_at asc,id asc limit 1`,
    [eventSlug, session.personId],
  );
  return linked[0]?.id;
}

export async function ticketPointSelection(ticketId: string): Promise<{
  mode: AttendeeTicketAccess["mode"];
  active: boolean;
  eventHasActive: boolean;
}> {
  const ticket = await getTicket(ticketId);
  if (!ticket) return { mode: "view-only", active: false, eventHasActive: false };
  const participant = await participantForTicket(ticketId);
  if (!participant) return { mode: "view-only", active: false, eventHasActive: false };
  const activeParticipantId = await activeParticipantForEvent(ticket.eventSlug);
  const active = activeParticipantId === participant.id;
  return {
    mode: active ? "scoring" : "view-only",
    active,
    eventHasActive: Boolean(activeParticipantId),
  };
}

export async function openedTicketsForEvent(eventSlug: string): Promise<AttendeeTicketAccess[]> {
  const session = await getAttendeeSession();
  return session?.tickets.filter((ticket) => ticket.eventSlug === eventSlug) ?? [];
}

export async function openedParticipantForEvent(
  eventSlug: string,
  ticketId?: string,
): Promise<string | undefined> {
  const tickets = await openedTicketsForEvent(eventSlug);
  if (ticketId) return tickets.find((ticket) => ticket.ticketId === ticketId)?.participantId;
  return tickets.length === 1 ? tickets[0]?.participantId : undefined;
}

export async function clearAttendeeSession(): Promise<void> {
  const id = readSessionId();
  if (!id) return;
  const redis = getRedis();
  if (redis) await redis.del(`${SESSION_PREFIX}${id}`);
  else if (allowMemoryFallback()) developmentSessions.delete(id);
  setCookie(ATTENDEE_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
