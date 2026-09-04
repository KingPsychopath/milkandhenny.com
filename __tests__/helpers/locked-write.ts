import { getPool, query } from "@/lib/platform/postgres.server";

/** Hold a real row lock until the competing operation reaches Postgres, avoiding timing guesses. */
export async function raceLockedWrite<T>(
  lockSql: string,
  parameters: unknown[],
  competing: () => Promise<T>,
  mutationSql: string,
): Promise<PromiseSettledResult<T>> {
  const client = await getPool()!.connect();
  let pending: Promise<PromiseSettledResult<T>> | undefined;
  try {
    await client.query("begin");
    await client.query(lockSql, parameters);
    pending = competing().then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason) => ({ status: "rejected" as const, reason }),
    );
    let blocked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      const rows = await query<{ blocked: boolean }>(
        "select exists(select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()) as blocked",
      );
      if (rows[0]?.blocked) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!blocked) throw new Error("Competing write never reached the held row lock");
    await client.query(mutationSql, parameters);
    await client.query("commit");
    return await pending;
  } finally {
    await client.query("rollback");
    client.release();
    await pending;
  }
}
