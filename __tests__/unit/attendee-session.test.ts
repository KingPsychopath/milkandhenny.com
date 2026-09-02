import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  records: new Map<string, unknown>(),
  linkedParticipants: [] as string[],
  people: new Set<string>(),
  personLookupGates: [] as Array<{ started: () => void; wait: Promise<void> }>,
  getCalls: 0,
  expireCalls: 0,
  ticketAccessReferences: new Map<string, string>(),
  ticketAuthorityVersions: new Map<string, number>(),
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
    get: async (key: string) => {
      state.getCalls += 1;
      return state.records.get(key) ?? null;
    },
    set: async (key: string, value: unknown, options?: { nx?: boolean }) => {
      if (options?.nx && state.records.has(key)) return null;
      state.records.set(key, value);
      return "OK";
    },
    del: async (key: string) => (state.records.delete(key) ? 1 : 0),
    expire: async () => {
      state.expireCalls += 1;
      return 1;
    },
    eval: async (_script: string, keys: string[], args: string[]) => {
      if (state.records.get(keys[0]!) !== args[0]) return 0;
      if (keys.length === 1) return state.records.delete(keys[0]!) ? 1 : 0;
      if (keys.length === 2) {
        if (!state.records.has(keys[1]!)) return 0;
        state.records.set(keys[1]!, JSON.parse(args[1]!));
        return 1;
      }
      if (!state.records.has(keys[1]!)) return 0;
      state.records.set(keys[2]!, JSON.parse(args[1]!));
      state.records.delete(keys[1]!);
      return 1;
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
  query: async (text: string, values: readonly unknown[]) => {
    if (!text.includes("from event_people")) return state.linkedParticipants.map((id) => ({ id }));
    const gate = state.personLookupGates.shift();
    if (gate) {
      gate.started();
      await gate.wait;
    }
    return [{ exists: state.people.has(String(values[0])) }];
  },
}));

vi.mock("@/features/events/store.server", () => ({
  getEvent: async (slug: string) =>
    slug === "session-night" ? { slug, eventId: "evt_session" } : null,
}));

vi.mock("@/features/tickets/store.server", () => ({
  getTicketByCurrentReference: async (reference: string) => {
    const id = ["01ARZ3NDEKTSV4RS", "01ARZ3NDEKTSV4RT"].find((candidate) => {
      const publicReference = state.ticketAccessReferences.get(candidate);
      return publicReference ? publicReference === reference : candidate === reference;
    });
    return id
      ? {
          id,
          accessReference: state.ticketAccessReferences.get(id),
          authorityVersion: state.ticketAuthorityVersions.get(id) ?? 0,
          eventSlug: "session-night",
          status: "valid",
        }
      : null;
  },
  getTickets: async (ids: string[]) =>
    ids
      .filter((id) => id === "01ARZ3NDEKTSV4RS" || id === "01ARZ3NDEKTSV4RT")
      .map((id) => ({
        id,
        accessReference: state.ticketAccessReferences.get(id),
        authorityVersion: state.ticketAuthorityVersions.get(id) ?? 0,
        eventSlug: "session-night",
        status: "valid",
      })),
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
  openedTicketsForEvent,
  revokeAttendeeSessionsForPerson,
  signOutAttendeeSession,
  ticketPointSelection,
} from "@/features/attendee-access/session.server";

describe("attendee session authentication", () => {
  beforeEach(() => {
    state.cookies.clear();
    state.records.clear();
    state.linkedParticipants = [];
    state.people = new Set([PERSON_SESSION, PERSON_MFA, PERSON_OTHER]);
    state.personLookupGates = [];
    state.getCalls = 0;
    state.expireCalls = 0;
    state.ticketAccessReferences.clear();
    state.ticketAuthorityVersions.clear();
  });

  it("reads an active session with one command and no expiry write", async () => {
    await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "scoring",
    });
    state.getCalls = 0;
    state.expireCalls = 0;

    await expect(getAttendeeSession()).resolves.not.toBeNull();

    expect(state.getCalls).toBe(1);
    expect(state.expireCalls).toBe(0);
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

  it("revokes anonymous ticket authority when a transfer rotates the public reference", async () => {
    const internalId = "01ARZ3NDEKTSV4RS";
    const rotatedReference = "01ARZ3NDEKTSV4RU";
    await openAttendeeTicket({
      ticketId: internalId,
      eventSlug: "session-night",
      mode: "scoring",
    });

    state.ticketAccessReferences.set(internalId, rotatedReference);
    state.ticketAuthorityVersions.set(internalId, 1);

    await expect(openedTicketsForEvent("session-night")).resolves.toEqual([]);
    await expect(activeParticipantForEvent("session-night")).resolves.toBeUndefined();
    await expect(
      openAttendeeTicket({
        ticketId: internalId,
        eventSlug: "session-night",
        mode: "scoring",
      }),
    ).resolves.toBeNull();
    await expect(
      openAttendeeTicket({
        ticketId: rotatedReference,
        eventSlug: "session-night",
        mode: "scoring",
      }),
    ).resolves.toMatchObject({ ticket: { ticketId: internalId, authorityVersion: 1 } });
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

    const retained = await getAttendeeSession();
    expect(retained).toMatchObject({
      schemaVersion: 1,
      personId: PERSON_SESSION,
    });
    expect(retained?.id).not.toBe(authenticated.id);

    state.people.delete(PERSON_SESSION);
    const { schemaVersion: _retainedSchemaVersion, ...legacyRetained } = retained!;
    state.records.set(`event-scoring:attendee-session:${legacyRetained.id}`, legacyRetained);
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
    expect(stored).toMatchObject({
      schemaVersion: 0,
      personId: "person_before_uuidv7",
    });
  });

  it("does not recreate a legacy session deleted by concurrent sign-out", async () => {
    await openAttendeeTicket({
      ticketId: "01ARZ3NDEKTSV4RS",
      eventSlug: "session-night",
      mode: "scoring",
    });
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    const { schemaVersion: _schemaVersion, ...legacy } = authenticated;
    const legacyKey = `event-scoring:attendee-session:${authenticated.id}`;
    state.records.set(legacyKey, legacy);

    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    let resumeLookup!: () => void;
    const wait = new Promise<void>((resolve) => {
      resumeLookup = resolve;
    });
    state.personLookupGates.push({ started: markLookupStarted, wait });
    const request = new Request("https://milkandhenny.com/api/example", {
      headers: { cookie: `mah-attendee-session=${authenticated.id}` },
    });

    const delayedRead = getAttendeeSessionForRequest(request);
    await lookupStarted;
    const signedOut = await signOutAttendeeSession();
    expect(state.records.has(legacyKey)).toBe(false);

    resumeLookup();
    await expect(delayedRead).resolves.toMatchObject({ personId: PERSON_SESSION });
    expect(state.records.has(legacyKey)).toBe(false);
    expect(signedOut?.tickets).toHaveLength(1);
    expect(signedOut?.personId).toBeUndefined();
  });

  it("rejects a stale second rotation instead of creating two successor sessions", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    const { schemaVersion: _schemaVersion, ...legacy } = authenticated;
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, legacy);

    let lookupsStarted = 0;
    let markBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      markBothStarted = resolve;
    });
    let resumeLookups!: () => void;
    const wait = new Promise<void>((resolve) => {
      resumeLookups = resolve;
    });
    const started = () => {
      lookupsStarted += 1;
      if (lookupsStarted === 2) markBothStarted();
    };
    state.personLookupGates.push({ started, wait }, { started, wait });

    const reads = [getAttendeeSession(), getAttendeeSession()];
    await bothStarted;
    resumeLookups();
    const results = await Promise.allSettled(reads);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const sessionKeys = [...state.records.keys()].filter((key) =>
      key.startsWith("event-scoring:attendee-session:"),
    );
    expect(sessionKeys).toHaveLength(1);
  });

  it("makes forced revocation win over an in-flight legacy rotation", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    const { schemaVersion: _schemaVersion, ...legacy } = authenticated;
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, legacy);

    let markLockedLookupStarted!: () => void;
    const lockedLookupStarted = new Promise<void>((resolve) => {
      markLockedLookupStarted = resolve;
    });
    let resumeLockedLookup!: () => void;
    const waitForResume = new Promise<void>((resolve) => {
      resumeLockedLookup = resolve;
    });
    state.personLookupGates.push(
      { started: () => undefined, wait: Promise.resolve() },
      { started: markLockedLookupStarted, wait: waitForResume },
    );

    const rotating = getAttendeeSession();
    await lockedLookupStarted;
    await expect(revokeAttendeeSessionsForPerson(PERSON_SESSION)).resolves.toBe(1);
    resumeLockedLookup();

    await expect(rotating).rejects.toThrow("Attendee session changed");
    expect(
      [...state.records.keys()].filter((key) => key.startsWith("event-scoring:attendee-session:")),
    ).toHaveLength(0);

    const reauthenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    await expect(getAttendeeSession()).resolves.toMatchObject({
      id: reauthenticated.id,
      personId: PERSON_SESSION,
      personSessionVersion: reauthenticated.personSessionVersion,
    });
  });

  it("rejects a session commit after its Redis lock ownership is lost", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    const { schemaVersion: _schemaVersion, ...legacy } = authenticated;
    state.records.set(`event-scoring:attendee-session:${authenticated.id}`, legacy);

    let markLockedLookupStarted!: () => void;
    const lockedLookupStarted = new Promise<void>((resolve) => {
      markLockedLookupStarted = resolve;
    });
    let resumeLockedLookup!: () => void;
    const waitForResume = new Promise<void>((resolve) => {
      resumeLockedLookup = resolve;
    });
    state.personLookupGates.push(
      { started: () => undefined, wait: Promise.resolve() },
      { started: markLockedLookupStarted, wait: waitForResume },
    );

    const rotating = getAttendeeSession();
    await lockedLookupStarted;
    state.records.delete(`event-scoring:attendee-session-lock:${authenticated.id}`);
    resumeLockedLookup();

    await expect(rotating).rejects.toThrow("Attendee session changed");
    const sessionKeys = [...state.records.keys()].filter((key) =>
      key.startsWith("event-scoring:attendee-session:"),
    );
    expect(sessionKeys).toEqual([`event-scoring:attendee-session:${authenticated.id}`]);
  });

  it("invalidates a stale successor created after forced revocation", async () => {
    const authenticated = await authenticateAttendeeSession({
      personId: PERSON_SESSION,
      verifiedEmailHash: "a".repeat(64),
    });
    await revokeAttendeeSessionsForPerson(PERSON_SESSION);

    const staleId = "S".repeat(32);
    state.records.set(`event-scoring:attendee-session:${staleId}`, {
      ...authenticated,
      id: staleId,
    });
    state.cookies.set("mah-attendee-session", staleId);

    const repaired = await getAttendeeSession();
    expect(repaired?.id).not.toBe(staleId);
    expect(repaired?.personId).toBeUndefined();
    expect(repaired?.personSessionVersion).toBeUndefined();
    expect(state.records.has(`event-scoring:attendee-session:${staleId}`)).toBe(false);
  });
});
