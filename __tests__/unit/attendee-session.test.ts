import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  records: new Map<string, unknown>(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => state.cookies.get(name),
  setCookie: (name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0) state.cookies.delete(name);
    else state.cookies.set(name, value);
  },
}));

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => ({
    get: async (key: string) => state.records.get(key) ?? null,
    set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && state.records.has(key)) return null;
      state.records.set(key, value);
      return "OK";
    },
    del: async (key: string) => (state.records.delete(key) ? 1 : 0),
    expire: async () => 1,
    eval: async (_script: string, keys: string[], args: string[]) => {
      if (state.records.get(keys[0]!) !== args[0]) return 0;
      return state.records.delete(keys[0]!) ? 1 : 0;
    },
  }),
}));

vi.mock("@/features/events/store.server", () => ({
  getEvent: async (slug: string) =>
    slug === "session-night" ? { slug, eventId: "evt_session" } : null,
}));

vi.mock("@/features/tickets/store.server", () => ({
  getTicket: async (id: string) =>
    id === "01ARZ3NDEKTSV4RS" || id === "01ARZ3NDEKTSV4RT"
      ? { id, eventSlug: "session-night", status: "valid" }
      : null,
}));

vi.mock("@/features/event-scoring/store.server", () => ({
  participantForTicket: async (ticketId: string) =>
    ticketId === "01ARZ3NDEKTSV4RS" || ticketId === "01ARZ3NDEKTSV4RT"
      ? {
          id: ticketId.endsWith("S") ? "participant_session" : "participant_second",
          eventSlug: "session-night",
        }
      : null,
}));

import {
  authenticateAttendeeSession,
  getAttendeeSession,
  openAttendeeTicket,
  signOutAttendeeSession,
} from "@/features/event-scoring/session.server";

describe("attendee session authentication", () => {
  beforeEach(() => {
    state.cookies.clear();
    state.records.clear();
  });

  it("rotates on verification and sign-out without losing selected tickets", async () => {
    const opened = await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "scoring",
    });
    expect(opened?.session.tickets).toHaveLength(1);
    const anonymousId = state.cookies.get("mah-attendee-session");
    expect(anonymousId).toBeTruthy();

    const authenticated = await authenticateAttendeeSession({
      personId: "person_session",
      verifiedEmailHash: "a".repeat(64),
    });
    expect(authenticated).toMatchObject({ personId: "person_session" });
    expect(authenticated.tickets).toHaveLength(1);
    expect(authenticated.id).not.toBe(anonymousId);
    expect(state.records.has(`event-scoring:attendee-session:${anonymousId}`)).toBe(false);

    expect(await getAttendeeSession()).toMatchObject({
      id: authenticated.id,
      personId: "person_session",
    });
    const signedOut = await signOutAttendeeSession();
    expect(signedOut?.personId).toBeUndefined();
    expect(signedOut?.verifiedEmailHash).toBeUndefined();
    expect(signedOut?.tickets).toHaveLength(1);
    expect(signedOut?.id).not.toBe(authenticated.id);
  });

  it("preserves a scoring choice on reload and switches only when another ticket is chosen", async () => {
    const first = await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "scoring",
    });
    expect(first?.session.activeParticipantByEventId.evt_session).toBe("participant_session");

    const reopened = await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "view-only",
    });
    expect(reopened?.session.tickets[0]?.mode).toBe("scoring");
    expect(reopened?.session.activeParticipantByEventId.evt_session).toBe("participant_session");

    await Promise.all([
      openAttendeeTicket({
        ticketId: "01ARZ3NDEKTSV4RS",
        eventSlug: "session-night",
        mode: "view-only",
      }),
      openAttendeeTicket({
        ticketId: "01ARZ3NDEKTSV4RT",
        eventSlug: "session-night",
        mode: "view-only",
      }),
    ]);
    expect(await getAttendeeSession()).toMatchObject({
      tickets: expect.arrayContaining([
        expect.objectContaining({ ticketId: "01ARZ3NDEKTSV4RS", mode: "scoring" }),
        expect.objectContaining({ ticketId: "01ARZ3NDEKTSV4RT", mode: "view-only" }),
      ]),
      activeParticipantByEventId: { evt_session: "participant_session" },
    });

    const second = await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RT",
      eventSlug: "session-night",
      mode: "scoring",
    });
    expect(second?.session.activeParticipantByEventId.evt_session).toBe("participant_second");
    expect(second?.session.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticketId: "01ARZ3NDEKTSV4RS", mode: "view-only" }),
        expect.objectContaining({ ticketId: "01ARZ3NDEKTSV4RT", mode: "scoring" }),
      ]),
    );
  });
});
