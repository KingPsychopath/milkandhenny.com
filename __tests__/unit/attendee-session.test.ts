import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  records: new Map<string, unknown>(),
  linkedParticipants: [] as string[],
  people: new Set<string>(),
}));

const PERSON_SESSION = "01890f3e-7b1a-7cc2-b5c3-3f8b6a4d2190";
const PERSON_MFA = "01890f3e-7b1b-7cc2-b5c3-3f8b6a4d2191";
const PERSON_OTHER = "01890f3e-7b1c-7cc2-b5c3-3f8b6a4d2192";

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
    scan: async (_cursor: string, options: { match?: string }) => [
      "0",
      [...state.records.keys()].filter((key) =>
        options.match?.endsWith("*") ? key.startsWith(options.match.slice(0, -1)) : true,
      ),
    ],
    pipeline: () => {
      const commands: Array<{ command: "get" | "del"; key: string }> = [];
      const pipeline = {
        get(key: string) {
          commands.push({ command: "get", key });
          return pipeline;
        },
        del(key: string) {
          commands.push({ command: "del", key });
          return pipeline;
        },
        async exec() {
          return commands.map(({ command, key }) =>
            command === "get"
              ? (state.records.get(key) ?? null)
              : Number(state.records.delete(key)),
          );
        },
      };
      return pipeline;
    },
  }),
}));

vi.mock("@/lib/platform/postgres.server", () => ({
  query: async (text: string, values: readonly unknown[]) =>
    text.includes("from event_people")
      ? [{ exists: state.people.has(String(values[0])) }]
      : state.linkedParticipants.map((id) => ({ id })),
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
  attendeeSessionSummaries,
  activeParticipantForEvent,
  authenticateAttendeeSession,
  beginAttendeeMfaSession,
  completeAttendeeMfaSession,
  getAttendeeSession,
  getAttendeeSessionForRequest,
  openAttendeeTicket,
  revokeAttendeeSessionsForPerson,
  signOutAttendeeSession,
  ticketPointSelection,
} from "@/features/event-scoring/session.server";

describe("attendee session authentication", () => {
  beforeEach(() => {
    state.cookies.clear();
    state.records.clear();
    state.linkedParticipants = [];
    state.people = new Set([PERSON_SESSION, PERSON_MFA, PERSON_OTHER]);
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
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    expect(authenticated).toMatchObject({ personId: PERSON_SESSION, schemaVersion: 1 });
    expect(authenticated.tickets).toHaveLength(1);
    expect(authenticated.id).not.toBe(anonymousId);
    expect(state.records.has(`event-scoring:attendee-session:${anonymousId}`)).toBe(false);

    expect(await getAttendeeSession()).toMatchObject({
      id: authenticated.id,
      personId: PERSON_SESSION,
    });
    const signedOut = await signOutAttendeeSession();
    expect(signedOut?.personId).toBeUndefined();
    expect(signedOut?.verifiedEmailHash).toBeUndefined();
    expect(signedOut?.tickets).toHaveLength(1);
    expect(signedOut?.id).not.toBe(authenticated.id);
  });

  it("keeps an email login anonymous until its second factor succeeds", async () => {
    const pending = await beginAttendeeMfaSession({
      personId: PERSON_MFA,
      verifiedEmailHash: "c".repeat(64),
      returnTo: "/my",
    });
    expect(pending.personId).toBeUndefined();
    expect(pending.pendingMfa).toMatchObject({ personId: PERSON_MFA, returnTo: "/my" });

    const authenticated = await completeAttendeeMfaSession({
      factor: "totp",
      totpId: "totp_1",
    });
    expect(authenticated).toMatchObject({
      personId: PERSON_MFA,
      pendingMfa: undefined,
      assurance: {
        primary: "email",
        factors: ["email", "totp"],
        phishingResistant: false,
      },
    });
  });

  it("does not complete an expired pending MFA session", async () => {
    const pending = await beginAttendeeMfaSession({
      personId: PERSON_MFA,
      verifiedEmailHash: "d".repeat(64),
      returnTo: "/my",
    });
    const key = `event-scoring:attendee-session:${pending.id}`;
    state.records.set(key, {
      ...pending,
      pendingMfa: {
        ...pending.pendingMfa!,
        createdAt: new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
      },
    });

    await expect(
      completeAttendeeMfaSession({ factor: "totp", totpId: "totp_1" }),
    ).resolves.toBeNull();
    await expect(getAttendeeSession()).resolves.toMatchObject({ personId: undefined });
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

  it("uses a signed-in person's first claimed event place until they choose another", async () => {
    await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    state.linkedParticipants = ["participant_claimed"];
    expect(await activeParticipantForEvent("session-night")).toBe("participant_claimed");

    state.linkedParticipants = ["participant_claimed", "participant_other"];
    expect(await activeParticipantForEvent("session-night")).toBe("participant_claimed");

    state.linkedParticipants = ["participant_session"];
    expect(await ticketPointSelection("01ARZ3NDEKTSV4RS")).toEqual({
      mode: "scoring",
      active: true,
      eventHasActive: true,
    });
    expect(await ticketPointSelection("01ARZ3NDEKTSV4RT")).toEqual({
      mode: "view-only",
      active: false,
      eventHasActive: true,
    });
  });

  it("summarizes and revokes every authenticated session for one person", async () => {
    const first = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    state.cookies.clear();
    const second = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    state.cookies.clear();
    await authenticateAttendeeSession({
      personId: PERSON_OTHER,
      verifiedEmailHash: "b".repeat(64),
    });

    expect((await attendeeSessionSummaries([PERSON_SESSION])).get(PERSON_SESSION)).toMatchObject({
      activeSessions: 2,
    });
    expect(await revokeAttendeeSessionsForPerson(PERSON_SESSION)).toBe(2);
    expect(state.records.has(`event-scoring:attendee-session:${first.id}`)).toBe(false);
    expect(state.records.has(`event-scoring:attendee-session:${second.id}`)).toBe(false);
    expect((await attendeeSessionSummaries([PERSON_SESSION])).has(PERSON_SESSION)).toBe(false);
    expect((await attendeeSessionSummaries([PERSON_OTHER])).get(PERSON_OTHER)).toMatchObject({
      activeSessions: 1,
    });
  });

  it("signs out a pre-UUID identity without losing opened tickets", async () => {
    const opened = await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "scoring",
    });
    expect(opened).not.toBeNull();
    const legacyId = opened!.session.id;
    state.records.set(`event-scoring:attendee-session:${legacyId}`, {
      ...opened!.session,
      schemaVersion: 0,
      personId: "person_before_uuidv7",
      authenticatedAt: new Date().toISOString(),
      authenticationMethod: "email",
      verifiedEmailHash: "a".repeat(64),
    });

    const repaired = await getAttendeeSession();

    expect(repaired).toMatchObject({ schemaVersion: 1, personId: undefined });
    expect(repaired?.tickets).toHaveLength(1);
    expect(repaired?.activeParticipantByEventId).toEqual({
      evt_session: "participant_session",
    });
    expect(repaired?.id).not.toBe(legacyId);
    expect(state.records.has(`event-scoring:attendee-session:${legacyId}`)).toBe(false);
  });

  it("validates a legacy UUID once before retaining its authenticated identity", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    const { schemaVersion: _schemaVersion, ...legacy } = authenticated;
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, legacy);

    await expect(getAttendeeSession()).resolves.toMatchObject({
      id: authenticated.id,
      schemaVersion: 1,
      personId: PERSON_SESSION,
    });

    state.people.delete(PERSON_SESSION);
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, legacy);
    await expect(getAttendeeSession()).resolves.toMatchObject({
      schemaVersion: 1,
      personId: undefined,
    });
  });

  it("fails closed for a stale identity at request-level authorization boundaries", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, {
      ...authenticated,
      schemaVersion: 0,
      personId: "person_before_uuidv7",
    });
    const request = new Request("https://milkandhenny.com/api/example", {
      headers: { cookie: `mah-attendee-session=${authenticated.id}` },
    });

    const repaired = await getAttendeeSessionForRequest(request);
    expect(repaired).toMatchObject({ id: authenticated.id, schemaVersion: 1 });
    expect(repaired).not.toHaveProperty("personId");
    const stored = state.records.get(`event-scoring:attendee-session:${authenticated.id}`);
    expect(stored).toMatchObject({ schemaVersion: 1 });
    expect(stored).not.toHaveProperty("personId");
  });
});
