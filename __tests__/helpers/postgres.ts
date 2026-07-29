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

export async function applySchema(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const { query } = await import("@/lib/platform/postgres.server");
  const { runMigrations } = await import("@/lib/platform/migrations.server");

  await query(`
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
}

export async function closeDatabase(): Promise<void> {
  const { closePool } = await import("@/lib/platform/postgres.server");
  await closePool();
}
