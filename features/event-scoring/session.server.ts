import { randomBytes } from "node:crypto";

import { getCookie, setCookie } from "@tanstack/react-start/server";

import { getRedis } from "@/lib/platform/redis.server";
import { getEvent } from "@/features/events/store.server";
import { getTicket } from "@/features/tickets/store.server";
import { participantForTicket } from "./store.server";

const COOKIE_NAME = "mah-attendee-session";
const SESSION_PREFIX = "event-scoring:attendee-session:";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60;
const SESSION_ROTATION_MS = 1000 * 60 * 60 * 24 * 7;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export type AttendeeTicketAccess = {
  ticketId: string;
  eventSlug: string;
  eventId: string;
  participantId: string;
  mode: "personal" | "managed" | "view-only";
  addedAt: string;
};

export type AttendeeSession = {
  id: string;
  tickets: AttendeeTicketAccess[];
  activeParticipantByEventId: Record<string, string>;
  createdAt: string;
  lastSeenAt: string;
};

const developmentSessions = new Map<string, AttendeeSession>();

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

async function write(session: AttendeeSession): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(`${SESSION_PREFIX}${session.id}`, session, { ex: SESSION_TTL_SECONDS });
    return;
  }
  if (!allowMemoryFallback()) throw new Error("Attendee session persistence is unavailable");
  developmentSessions.set(session.id, session);
}

async function loadOrCreate(): Promise<AttendeeSession> {
  const existingId = readSessionId();
  const existing = existingId ? await readById(existingId) : null;
  if (existing) {
    const touched = { ...existing, lastSeenAt: new Date().toISOString() };
    await write(touched);
    setSessionCookie(touched.id);
    return touched;
  }
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

export async function getAttendeeSession(): Promise<AttendeeSession | null> {
  const id = readSessionId();
  if (!id) return null;
  const session = await readById(id);
  if (!session) return null;
  const touched = { ...session, lastSeenAt: new Date().toISOString() };
  if (Date.now() - Date.parse(session.createdAt) >= SESSION_ROTATION_MS) {
    const rotated = {
      ...touched,
      id: sessionId(),
      createdAt: new Date().toISOString(),
    };
    await write(rotated);
    const redis = getRedis();
    if (redis) await redis.del(`${SESSION_PREFIX}${id}`);
    else if (allowMemoryFallback()) developmentSessions.delete(id);
    setSessionCookie(rotated.id);
    return rotated;
  }
  await write(touched);
  setSessionCookie(touched.id);
  return touched;
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
  const participant = await participantForTicket(ticket.id);
  if (!participant || participant.eventSlug !== input.eventSlug) return null;
  const session = await loadOrCreate();
  const existing = session.tickets.find((entry) => entry.ticketId === input.ticketId);
  const access: AttendeeTicketAccess = {
    ticketId: ticket.id,
    eventSlug: input.eventSlug,
    eventId: event.eventId,
    participantId: participant.id,
    mode: existing && input.mode === "view-only" ? existing.mode : input.mode,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
  const tickets = session.tickets.some((entry) => entry.ticketId === access.ticketId)
    ? session.tickets.map((entry) =>
        entry.ticketId === access.ticketId ? { ...entry, mode: access.mode } : entry,
      )
    : [...session.tickets, access];
  const activeParticipantByEventId = session.activeParticipantByEventId[event.eventId]
    ? session.activeParticipantByEventId
    : input.mode === "view-only"
      ? session.activeParticipantByEventId
      : { ...session.activeParticipantByEventId, [event.eventId]: participant.id };
  const updated = {
    ...session,
    tickets,
    activeParticipantByEventId,
    lastSeenAt: new Date().toISOString(),
  } satisfies AttendeeSession;
  await write(updated);
  setSessionCookie(updated.id);
  return { session: updated, ticket: access };
}

export async function setActiveParticipant(input: {
  eventSlug: string;
  participantId: string;
}): Promise<AttendeeSession | null> {
  const session = await getAttendeeSession();
  const event = await getEvent(input.eventSlug);
  if (
    !session ||
    !event?.eventId ||
    !session.tickets.some(
      (ticket) =>
        ticket.eventId === event.eventId &&
        ticket.participantId === input.participantId &&
        ticket.mode !== "view-only",
    )
  )
    return null;
  const updated = {
    ...session,
    activeParticipantByEventId: {
      ...session.activeParticipantByEventId,
      [event.eventId]: input.participantId,
    },
    lastSeenAt: new Date().toISOString(),
  } satisfies AttendeeSession;
  await write(updated);
  return updated;
}

export async function removeTicketFromDevice(ticketId: string): Promise<boolean> {
  const session = await getAttendeeSession();
  if (!session) return false;
  const removed = session.tickets.find((ticket) => ticket.ticketId === ticketId);
  if (!removed) return false;
  const tickets = session.tickets.filter((ticket) => ticket.ticketId !== ticketId);
  const active = { ...session.activeParticipantByEventId };
  if (active[removed.eventId] === removed.participantId) delete active[removed.eventId];
  await write({ ...session, tickets, activeParticipantByEventId: active });
  return true;
}

export async function activeParticipantForEvent(eventSlug: string): Promise<string | undefined> {
  const [session, event] = await Promise.all([getAttendeeSession(), getEvent(eventSlug)]);
  return session && event?.eventId ? session.activeParticipantByEventId[event.eventId] : undefined;
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
