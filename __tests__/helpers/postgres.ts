/**
 * Test database helper.
 *
 * These tests run against a **real Postgres**, not an emulator. The
 * properties they assert — no overselling under concurrent buyers, one
 * admission under concurrent scans — are properties of row locks and
 * `where ... is null` predicates. An in-memory SQL fake would happily run the
 * statements and prove nothing about either.
 *
 * Start one with:
 *
 *   docker run -d --name mah-test-pg -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mah_test -p 55432:5432 postgres:18-alpine
 *
 * Suites call `describeWithDatabase`, which skips cleanly when no database is
 * reachable so the rest of the suite still runs. `vitest.globalSetup.ts`
 * probes once and records the answer.
 */

import { describe } from "vitest";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

export const databaseReady = process.env.MAH_TEST_DB_READY === "1";

/** `describe`, or `describe.skip` when there is no test database. */
export const describeWithDatabase = databaseReady ? describe : describe.skip;

/**
 * Serialises whole test files against the shared database.
 *
 * Vitest runs files in parallel workers; two suites resetting and truncating
 * the same tables would corrupt each other mid-test. Each file takes this
 * session-level advisory lock in `applySchema` and holds it until
 * `closeDatabase`, so database suites run one file at a time while everything
 * else stays parallel.
 */
const TEST_SUITE_LOCK_KEY = 8_147_299;
let suiteLockClient: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  release: () => void;
} | null = null;

export async function applySchema(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const { getPool, query } = await import("@/lib/platform/postgres.server");
  const { runMigrations } = await import("@/lib/platform/migrations.server");

  const pool = getPool();
  if (pool && !suiteLockClient) {
    const client = await pool.connect();
    await client.query("select pg_advisory_lock($1)", [TEST_SUITE_LOCK_KEY]);
    suiteLockClient = client;
  }

  await query(`
    drop table if exists scanner_links cascade;
    drop table if exists checkpoint_usage cascade;
    drop table if exists checkpoints cascade;
    drop table if exists checkout_sessions cascade;
    drop table if exists tickets cascade;
    drop table if exists ticket_types cascade;
    drop table if exists events cascade;
    drop table if exists schema_migrations cascade;
  `);
  await runMigrations();
}

/** Fast per-test cleanup that keeps the schema in place. */
export async function truncateAll(): Promise<void> {
  const { query } = await import("@/lib/platform/postgres.server");
  await query(`truncate checkout_sessions, tickets, ticket_types, events restart identity cascade`);
  // New tables land via cascade from events/tickets, but be explicit so a
  // future FK loosening cannot quietly leak state between tests.
  await query(`truncate scanner_links, checkpoint_usage, checkpoints cascade`).catch(() => {});
}

export async function closeDatabase(): Promise<void> {
  if (suiteLockClient) {
    await suiteLockClient
      .query("select pg_advisory_unlock($1)", [TEST_SUITE_LOCK_KEY])
      .catch(() => {});
    suiteLockClient.release();
    suiteLockClient = null;
  }
  const { closePool } = await import("@/lib/platform/postgres.server");
  await closePool();
}
