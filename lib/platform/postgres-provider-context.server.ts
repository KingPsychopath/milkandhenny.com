import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient, QueryResultRow } from "pg";

import * as postgres from "./postgres.server";

export type PostgresProvider = {
  getPool: typeof postgres.getPool;
  query: typeof postgres.query;
  queryOne: typeof postgres.queryOne;
  transaction: typeof postgres.transaction;
};

export const nodePostgresProvider: PostgresProvider = {
  getPool: () => postgres.getPool(),
  query: (...args) => postgres.query(...args),
  queryOne: (...args) => postgres.queryOne(...args),
  transaction: (...args) => postgres.transaction(...args),
};

const activePostgresProvider = new AsyncLocalStorage<PostgresProvider>();

export function withPostgresProvider<A>(
  provider: PostgresProvider,
  run: () => Promise<A>,
): Promise<A> {
  return activePostgresProvider.run(provider, run);
}

/** Reuse an owning transaction for nested workflow calls without opening another connection. */
export function withPostgresClient<A>(client: PoolClient, run: () => Promise<A>): Promise<A> {
  const parent = current();
  const queryInClient: PostgresProvider["query"] = async (text, values = []) => {
    const result = await client.query(text, values as unknown[]);
    return result.rows;
  };
  const provider: PostgresProvider = {
    getPool: parent.getPool,
    query: queryInClient,
    queryOne: async <T extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      (await queryInClient<T>(text, values))[0] ?? null,
    transaction: async (fn) => fn(client),
  };
  return withPostgresProvider(provider, run);
}

function current(): PostgresProvider {
  return activePostgresProvider.getStore() ?? nodePostgresProvider;
}

export const getPool: PostgresProvider["getPool"] = () => current().getPool();
export const query: PostgresProvider["query"] = (...args) => current().query(...args);
export const queryOne: PostgresProvider["queryOne"] = (...args) => current().queryOne(...args);
export const transaction: PostgresProvider["transaction"] = (...args) =>
  current().transaction(...args);
