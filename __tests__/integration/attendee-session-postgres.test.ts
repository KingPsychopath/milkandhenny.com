import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  cleanupPostgresAttendeeSessions,
  listPostgresSessionsForPeople,
  mutatePostgresAttendeeSession,
  readPostgresAttendeeSession,
  readPostgresPersonSessionVersion,
  revokePostgresPersonSessions,
  writePostgresAttendeeSession,
} from "@/features/attendee-access/session-postgres.server";
import type { AttendeeSession } from "@/features/attendee-access/session.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const PERSON = "01890f3e-7b1a-7cc2-b5c3-3f8b6a4d2190";
const OTHER = "01890f3e-7b1c-7cc2-b5c3-3f8b6a4d2192";

function session(id: string, personId?: string): AttendeeSession {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id,
    tickets: [],
    activeParticipantByEventId: {},
    ...(personId ? { personId } : {}),
    createdAt: now,
    lastSeenAt: now,
  };
}

describeWithDatabase("Postgres attendee sessions", () => {
  beforeAll(async () => {
    vi.stubEnv("ATTENDEE_SESSION_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-attendee-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate attendee_sessions, attendee_session_versions");
  });

  it("stores a hashed lookup, preserves payload and expires it", async () => {
    const original = session("attendee-session-test-00000000000001", PERSON);
    await writePostgresAttendeeSession(original);
    expect(await readPostgresAttendeeSession(original.id)).toEqual(original);
    const stored = await query<{ id_hash: string; session_data: AttendeeSession }>(
      "select id_hash, session_data from attendee_sessions",
    );
    expect(stored[0]?.id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored[0]?.id_hash).not.toBe(original.id);
    expect(stored[0]?.session_data.id).toBe(original.id);
    expect(await listPostgresSessionsForPeople([PERSON])).toEqual([original]);
    expect(await listPostgresSessionsForPeople([OTHER])).toEqual([]);
    await query(
      "update attendee_sessions set created_at = now() - interval '1 hour', expires_at = now() - interval '1 second'",
    );
    expect(await readPostgresAttendeeSession(original.id)).toBeNull();
    expect(await cleanupPostgresAttendeeSessions(1)).toBe(1);
  });

  it("serializes rotation and leaves exactly one live session", async () => {
    const original = session("attendee-session-test-00000000000002", PERSON);
    await writePostgresAttendeeSession(original);
    const attempts = await Promise.allSettled(
      [1, 2].map((number) =>
        mutatePostgresAttendeeSession(original.id, async (mutation) => {
          const current = await readPostgresAttendeeSession(original.id);
          expect(current).not.toBeNull();
          await mutation.replaceCurrent({
            ...current!,
            id: `attendee-session-test-rotated-0000000${number}`,
          });
        }),
      ),
    );
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await readPostgresAttendeeSession(original.id)).toBeNull();
    expect(await query("select 1 from attendee_sessions")).toHaveLength(1);
  });

  it("revokes both authenticated and pending-MFA sessions atomically", async () => {
    const authenticated = session("attendee-session-test-00000000000003", PERSON);
    const pending = {
      ...session("attendee-session-test-00000000000004"),
      pendingMfa: {
        personId: PERSON,
        verifiedEmailHash: "a".repeat(64),
        returnTo: "/events",
        createdAt: new Date().toISOString(),
      },
    } satisfies AttendeeSession;
    const unrelated = session("attendee-session-test-00000000000005", OTHER);
    await Promise.all(
      [authenticated, pending, unrelated].map((value) => writePostgresAttendeeSession(value)),
    );
    expect(await revokePostgresPersonSessions(PERSON)).toBe(2);
    expect(await readPostgresAttendeeSession(authenticated.id)).toBeNull();
    expect(await readPostgresAttendeeSession(pending.id)).toBeNull();
    expect(await readPostgresAttendeeSession(unrelated.id)).toEqual(unrelated);
    expect(await readPostgresPersonSessionVersion(PERSON)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
