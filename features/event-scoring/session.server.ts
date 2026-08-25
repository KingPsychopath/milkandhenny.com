import { randomBytes, randomInt } from "node:crypto";

import { getCookie, setCookie } from "@tanstack/react-start/server";

import { getRedis } from "@/lib/platform/redis.server";
import { getCookie as getRequestCookie } from "@/lib/http/cookies";
import { getEvent } from "@/features/events/store.server";
import { getTicket } from "@/features/tickets/store.server";
import { participantForTicket } from "./store.server";

const COOKIE_NAME = "mah-attendee-session";
const SESSION_PREFIX = "event-scoring:attendee-session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;
const SESSION_ROTATION_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
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
  id: string;
  tickets: AttendeeTicketAccess[];
  activeParticipantByEventId: Record<string, string>;
  personId?: string;
  verifiedEmailHash?: string;
  authenticatedAt?: string;
  createdAt: string;
  lastSeenAt: string;
};

export type PersonAttendeeSessionSummary = {
  activeSessions: number;
  lastSeenAt?: string;
  authenticatedAt?: string;
};

const developmentSessions = new Map<string, AttendeeSession>();
const developmentSessionLocks = new Map<string, Promise<void>>();

function allowMemoryFallback(): boolean {
  return process.env.NODE_ENV !== "production";
}

function sessionId(): string {
  return randomBytes(24).toString("base64url");
}

function readSessionId(): string | null {
  const value = getCookie(COOKIE_NAME);
  return typeof value === "string" && SESSION_ID_PATTERN.test(value) ? value : null;
}

function setSessionCookie(id: string): void {
  setCookie(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
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

async function readById(id: string): Promise<AttendeeSession | null> {
  const redis = getRedis();
  if (redis) return parseStored(await redis.get(`${SESSION_PREFIX}${id}`));
  return allowMemoryFallback() ? (developmentSessions.get(id) ?? null) : null;
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
  const sessions = (await storedSessions()).filter((session) => session.personId === personId);
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
  if (existing) return refresh(existing);
  const now = new Date().toISOString();
  const created = {
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
  changes: Pick<AttendeeSession, "personId" | "verifiedEmailHash" | "authenticatedAt">,
): Promise<AttendeeSession> {
  return withSessionMutation(session.id, async () => {
    const current = (await readById(session.id)) ?? session;
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
  verifiedEmailHash: string;
}): Promise<AttendeeSession> {
  const session = await loadOrCreate();
  return rotateSession(session, {
    personId: input.personId,
    verifiedEmailHash: input.verifiedEmailHash,
    authenticatedAt: new Date().toISOString(),
  });
}

export async function signOutAttendeeSession(): Promise<AttendeeSession | null> {
  const session = await getAttendeeSession();
  if (!session) return null;
  const {
    personId: _personId,
    verifiedEmailHash: _email,
    authenticatedAt: _at,
    ...anonymous
  } = session;
  return rotateSession(anonymous, {
    personId: undefined,
    verifiedEmailHash: undefined,
    authenticatedAt: undefined,
  });
}

export async function getAttendeeSession(): Promise<AttendeeSession | null> {
  const id = readSessionId();
  if (!id) return null;
  const session = await readById(id);
  if (!session) return null;
  if (Date.now() - Date.parse(session.createdAt) >= SESSION_ROTATION_MS) {
    return rotateSession(session, {
      personId: session.personId,
      verifiedEmailHash: session.verifiedEmailHash,
      authenticatedAt: session.authenticatedAt,
    });
  }
  return refresh(session);
}

/** Read identity for an explicit HTTP request without relying on Start context. */
export async function getAttendeeSessionForRequest(
  request: Request,
): Promise<AttendeeSession | null> {
  const id = getRequestCookie(request, COOKIE_NAME);
  if (!id || !SESSION_ID_PATTERN.test(id)) return null;
  return readById(id);
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
    const session = (await readById(initial.id)) ?? initial;
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
  return session && event?.eventId ? session.activeParticipantByEventId[event.eventId] : undefined;
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
  setCookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
