import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const HASH = /^[a-f0-9]{64}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{32,64}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid attendee session timestamp");
  }
  return new Date(value).toISOString();
}

function parseExport(bytes) {
  const source = JSON.parse(bytes.toString("utf8"));
  if (
    !source ||
    typeof source !== "object" ||
    !Array.isArray(source.sessions) ||
    !source.personVersions ||
    typeof source.personVersions !== "object" ||
    Array.isArray(source.personVersions)
  ) {
    throw new Error("Invalid attendee session export");
  }
  const seen = new Set();
  const sessions = source.sessions.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      !SESSION_ID.test(row.id) ||
      !row.value ||
      typeof row.value !== "object" ||
      Array.isArray(row.value) ||
      row.value.id !== row.id ||
      !Array.isArray(row.value.tickets) ||
      !row.value.activeParticipantByEventId ||
      typeof row.value.activeParticipantByEventId !== "object" ||
      Array.isArray(row.value.activeParticipantByEventId) ||
      (row.value.personId !== undefined && !UUID_V7.test(row.value.personId)) ||
      (row.value.pendingMfa !== undefined &&
        (!row.value.pendingMfa || !UUID_V7.test(row.value.pendingMfa.personId))) ||
      (row.value.schemaVersion !== undefined && row.value.schemaVersion !== 1)
    ) {
      throw new Error("Invalid attendee session record");
    }
    if (seen.has(row.id)) throw new Error("Duplicate attendee session ID");
    seen.add(row.id);
    const createdAt = timestamp(row.value.createdAt);
    const lastSeenAt = timestamp(row.value.lastSeenAt);
    const expiresAt = timestamp(row.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
      throw new Error("Attendee session expiry precedes creation");
    }
    const authenticatedAt = row.value.authenticatedAt ? timestamp(row.value.authenticatedAt) : null;
    return {
      id: row.id,
      data: row.value,
      createdAt,
      lastSeenAt,
      expiresAt,
      authenticatedAt,
      personId: row.value.personId ?? null,
      pendingPersonId: row.value.pendingMfa?.personId ?? null,
    };
  });
  const personVersions = Object.entries(source.personVersions);
  for (const [personId, version] of personVersions) {
    if (!UUID_V7.test(personId) || typeof version !== "string" || !SESSION_ID.test(version)) {
      throw new Error("Invalid attendee person-session version");
    }
  }
  return { sessions, personVersions };
}

async function main() {
  const [sourceHash, filePath] = process.argv.slice(2);
  if (!HASH.test(sourceHash ?? "") || !filePath || !isAbsolute(filePath)) {
    throw new Error(
      "Usage: node ops/import-attendee-sessions.mjs <rdb-sha256> <absolute-private-json-path>",
    );
  }
  const file = await stat(filePath);
  if (!file.isFile() || file.size > 16 * 1024 * 1024 || (file.mode & 0o077) !== 0) {
    throw new Error("Input must be a private regular JSON file no larger than 16 MiB");
  }
  const source = parseExport(await readFile(filePath));
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is required for session hashing");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    const existingSessions = await client.query(
      "select distinct source_rdb_sha256 from attendee_sessions",
    );
    const existingVersions = await client.query(
      "select distinct source_rdb_sha256 from attendee_session_versions",
    );
    if (
      [...existingSessions.rows, ...existingVersions.rows].some(
        (row) => row.source_rdb_sha256 !== sourceHash,
      )
    ) {
      throw new Error("Attendee state already contains runtime or another export's records");
    }
    for (const [personId, version] of source.personVersions) {
      await client.query(
        `insert into attendee_session_versions (person_id, version, source_rdb_sha256)
         values ($1, $2, $3) on conflict (person_id) do nothing`,
        [personId, version, sourceHash],
      );
      const verified = await client.query(
        `select 1 from attendee_session_versions
          where person_id = $1 and version = $2 and source_rdb_sha256 = $3`,
        [personId, version, sourceHash],
      );
      if (verified.rowCount !== 1) throw new Error("Person-session version import conflict");
    }
    for (const session of source.sessions) {
      const idHash = createHmac("sha256", secret)
        .update(`mah:attendee-session:id:v1:${session.id}`)
        .digest("hex");
      const data = JSON.stringify(session.data);
      await client.query(
        `insert into attendee_sessions
           (id_hash, session_data, person_id, pending_person_id, created_at, last_seen_at,
            authenticated_at, expires_at, source_rdb_sha256)
         values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id_hash) do nothing`,
        [
          idHash,
          data,
          session.personId,
          session.pendingPersonId,
          session.createdAt,
          session.lastSeenAt,
          session.authenticatedAt,
          session.expiresAt,
          sourceHash,
        ],
      );
      const verified = await client.query(
        `select 1 from attendee_sessions
          where id_hash = $1 and session_data = $2::jsonb
            and person_id is not distinct from $3::uuid
            and pending_person_id is not distinct from $4::uuid
            and created_at = $5 and last_seen_at = $6
            and authenticated_at is not distinct from $7::timestamptz
            and expires_at = $8 and source_rdb_sha256 = $9`,
        [
          idHash,
          data,
          session.personId,
          session.pendingPersonId,
          session.createdAt,
          session.lastSeenAt,
          session.authenticatedAt,
          session.expiresAt,
          sourceHash,
        ],
      );
      if (verified.rowCount !== 1) throw new Error("Attendee session import conflict");
    }
    const sessionCount = await client.query(
      "select count(*)::integer as count from attendee_sessions",
    );
    const versionCount = await client.query(
      "select count(*)::integer as count from attendee_session_versions",
    );
    if (
      sessionCount.rows[0]?.count !== source.sessions.length ||
      versionCount.rows[0]?.count !== source.personVersions.length
    ) {
      throw new Error("Attendee state import count mismatch");
    }
    await client.query("commit");
    console.log(
      JSON.stringify({
        event: "attendee_sessions.imported",
        sourceHash,
        sessions: source.sessions.length,
        personVersions: source.personVersions.length,
      }),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Attendee session import failed");
  process.exitCode = 1;
});
