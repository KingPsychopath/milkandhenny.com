import { AsyncLocalStorage } from "node:async_hooks";

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

function current(): PostgresProvider {
  return activePostgresProvider.getStore() ?? nodePostgresProvider;
}

export const getPool: PostgresProvider["getPool"] = () => current().getPool();
export const query: PostgresProvider["query"] = (...args) => current().query(...args);
export const queryOne: PostgresProvider["queryOne"] = (...args) => current().queryOne(...args);
export const transaction: PostgresProvider["transaction"] = (...args) =>
  current().transaction(...args);
