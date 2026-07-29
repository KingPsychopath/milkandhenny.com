import { Client } from "pg";

/**
 * Probe for a test Postgres once, before any suite runs.
 *
 * Database-backed suites skip rather than fail when none is reachable, so a
 * clone without Docker still gets a green run for everything else. CI is
 * expected to provide one.
 */
export default async function globalSetup() {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

  const client = new Client({ connectionString, connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    await client.query("select 1");
    process.env.MAH_TEST_DB_READY = "1";
    process.env.TEST_DATABASE_URL = connectionString;
  } catch {
    process.env.MAH_TEST_DB_READY = "0";
    console.warn(
      "\n[tests] No Postgres at",
      connectionString.replace(/:[^:@]*@/, ":***@"),
      "— database-backed suites will be skipped.\n",
    );
  } finally {
    await client.end().catch(() => {});
  }
}
