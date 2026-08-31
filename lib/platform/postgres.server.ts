import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { log } from "./logger.server";
import { currentOperationSignal } from "./operation-context.server";

const DATABASE_QUERY_TIMEOUT_MS =
  Number.parseInt(process.env.DATABASE_QUERY_TIMEOUT_MS ?? "", 10) || 15_000;
const DATABASE_LOCK_TIMEOUT_MS =
  Number.parseInt(process.env.DATABASE_LOCK_TIMEOUT_MS ?? "", 10) || 5_000;

/**
 * Provider-neutral SQL persistence.
 *
 * `DATABASE_URL` is the application contract, the same posture as
 * `REDIS_REST_*` and the S3 credentials: the host supplies a Postgres URL and
 * nothing in application code cares whose Postgres it is.
 *
 * Redis keeps what it is good at — sessions, rate limits, room state, wake
 * fan-out. Events and tickets live here because they need transactions:
 * a refund has to mark the ticket refunded and release its seat together or
 * not at all, and "sold" has to be a real count rather than a counter that
 * can drift from the rows it claims to describe.
 */

let pool: Pool | null = null;

export function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() !== null;
}

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * Lazily built, one pool per process, closed by a Nitro shutdown hook.
 *
 * The pool is deliberately small: Railway Postgres has a modest connection
 * ceiling and this app runs several services against it.
 */
export function getPool(): Pool | null {
  const connectionString = getDatabaseUrl();
  if (!connectionString) return null;

  pool ??= (() => {
    const created = new Pool({
      connectionString,
      max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10) || 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // Railway's internal network terminates TLS at the proxy; managed
      // providers that require TLS still work because `pg` reads `sslmode`
      // from the connection string.
    });

    // An idle-client error is emitted on the pool, not on a query. Without a
    // listener it crashes the process.
    created.on("error", (error) => {
      log.error("postgres", "Idle client error", {}, error);
    });

    return created;
  })();

  return pool;
}

function requirePool(): Pool {
  const active = getPool();
  if (!active) throw new DatabaseUnavailableError();
  return active;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  currentOperationSignal()?.throwIfAborted();
  // Keep the deadline local to this checkout. A pool-wide timeout also applies to callers that
  // intentionally hold a session (migrations and advisory locks), while RESET before release keeps
  // the next borrower from inheriting this operation's policy.
  const client = await requirePool().connect();
  let discard = false;
  try {
    await client.query(`SET statement_timeout = '${DATABASE_QUERY_TIMEOUT_MS}ms'`);
    const result = await client.query<T>(text, values as unknown[]);
    currentOperationSignal()?.throwIfAborted();
    return result.rows;
  } finally {
    try {
      await client.query("RESET statement_timeout");
    } catch (error) {
      discard = true;
      log.error("postgres", "Failed to reset query deadline", {}, error);
    }
    client.release(discard);
  }
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * This is the reason events and tickets moved off Redis: issuance,
 * refunds and capacity all need several writes to land together.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await requirePool().connect();
  try {
    currentOperationSignal()?.throwIfAborted();
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${DATABASE_QUERY_TIMEOUT_MS}ms'`);
    await client.query(`SET LOCAL lock_timeout = '${DATABASE_LOCK_TIMEOUT_MS}ms'`);
    const result = await fn(client);
    currentOperationSignal()?.throwIfAborted();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      log.error("postgres", "Rollback failed", {}, rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Cheap liveness probe for `/health`. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const startedAt = Date.now();
  try {
    await query("select 1");
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    log.error("postgres", "Health probe failed", {}, error);
    return { ok: false, latencyMs: Date.now() - startedAt };
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
}
