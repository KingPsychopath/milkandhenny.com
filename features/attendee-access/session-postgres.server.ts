import { createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres-provider-context.server";
import type { AttendeeSession } from "./session.server";

export type PostgresSessionMutation = {
  writeCurrent: (session: AttendeeSession) => Promise<void>;
  replaceCurrent: (session: AttendeeSession) => Promise<void>;
};

export function postgresAttendeeSessionsSelected(): boolean {
  return process.env.ATTENDEE_SESSION_STORE === "postgres";
}

function sessionHash(id: string): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Attendee session hash secret unavailable");
  return createHmac("sha256", secret).update(`mah:attendee-session:id:v1:${id}`).digest("hex");
}

function sessionParams(session: AttendeeSession) {
  return [
    sessionHash(session.id),
    JSON.stringify(session),
    session.personId ?? null,
    session.pendingMfa?.personId ?? null,
    session.createdAt,
    session.lastSeenAt,
    session.authenticatedAt ?? null,
  ];
}

async function insertSession(client: PoolClient, session: AttendeeSession): Promise<void> {
  await client.query(
    `insert into attendee_sessions
       (id_hash, session_data, person_id, pending_person_id, created_at, last_seen_at,
        authenticated_at, expires_at)
     values ($1, $2::jsonb, $3, $4, $5, $6, $7, clock_timestamp() + interval '60 days')`,
    sessionParams(session),
  );
}

export async function readPostgresAttendeeSession(id: string): Promise<AttendeeSession | null> {
  const row = await queryOne<{ session_data: AttendeeSession }>(
    `select session_data from attendee_sessions
      where id_hash = $1 and expires_at > clock_timestamp()`,
    [sessionHash(id)],
  );
  return row?.session_data ?? null;
}

export async function writePostgresAttendeeSession(session: AttendeeSession): Promise<void> {
  await query(
    `insert into attendee_sessions
       (id_hash, session_data, person_id, pending_person_id, created_at, last_seen_at,
        authenticated_at, expires_at)
     values ($1, $2::jsonb, $3, $4, $5, $6, $7, clock_timestamp() + interval '60 days')`,
    sessionParams(session),
  );
}

export async function mutatePostgresAttendeeSession<T>(
  id: string,
  use: (mutation: PostgresSessionMutation) => Promise<T>,
): Promise<T> {
  const idHash = sessionHash(id);
  return transaction(async (client) => {
    const { rows } = await client.query(
      `select 1 from attendee_sessions
        where id_hash = $1 and expires_at > clock_timestamp()
        for update`,
      [idHash],
    );
    if (rows.length !== 1) throw new Error("Attendee session changed; try again");
    return use({
      writeCurrent: async (session) => {
        if (session.id !== id) throw new Error("Cannot replace a session with a different ID");
        const updated = await client.query(
          `update attendee_sessions
              set session_data = $2::jsonb, person_id = $3, pending_person_id = $4,
                  created_at = $5, last_seen_at = $6, authenticated_at = $7,
                  expires_at = clock_timestamp() + interval '60 days', source_rdb_sha256 = null
            where id_hash = $1 and expires_at > clock_timestamp()`,
          sessionParams(session),
        );
        if (updated.rowCount !== 1) throw new Error("Attendee session changed; try again");
      },
      replaceCurrent: async (session) => {
        if (session.id === id) throw new Error("Session rotation requires a new ID");
        await insertSession(client, session);
        const removed = await client.query(
          "delete from attendee_sessions where id_hash = $1 returning id_hash",
          [idHash],
        );
        if (removed.rowCount !== 1) throw new Error("Attendee session changed; try again");
      },
    });
  });
}

export async function readPostgresPersonSessionVersion(
  personId: string,
): Promise<string | undefined> {
  const row = await queryOne<{ version: string }>(
    "select version from attendee_session_versions where person_id = $1",
    [personId],
  );
  return row?.version;
}

export async function listPostgresSessionsForPeople(
  personIds: readonly string[],
): Promise<AttendeeSession[]> {
  if (personIds.length === 0) return [];
  const rows = await query<{ session_data: AttendeeSession }>(
    `select session_data from attendee_sessions
      where person_id = any($1::uuid[]) and expires_at > clock_timestamp()`,
    [personIds],
  );
  return rows.map((row) => row.session_data);
}

export async function revokePostgresPersonSessions(personId: string): Promise<number> {
  const version = randomBytes(24).toString("base64url");
  return transaction(async (client) => {
    await client.query(
      `insert into attendee_session_versions (person_id, version) values ($1, $2)
       on conflict (person_id) do update
         set version = excluded.version, source_rdb_sha256 = null`,
      [personId, version],
    );
    const removed = await client.query(
      `delete from attendee_sessions
        where person_id = $1 or pending_person_id = $1
        returning id_hash`,
      [personId],
    );
    return removed.rowCount ?? 0;
  });
}

export async function deletePostgresAttendeeSession(id: string): Promise<void> {
  await query("delete from attendee_sessions where id_hash = $1", [sessionHash(id)]);
}

export async function cleanupPostgresAttendeeSessions(limit = 10_000): Promise<number> {
  if (!postgresAttendeeSessionsSelected()) return 0;
  const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const rows = await query(
    `delete from attendee_sessions where ctid in (
       select ctid from attendee_sessions
        where expires_at < clock_timestamp()
        order by expires_at limit $1
     ) returning id_hash`,
    [bounded],
  );
  return rows.length;
}
