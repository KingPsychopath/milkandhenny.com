import { afterAll, beforeAll, expect, it } from "vitest";

import { PostgresMultiplayerRealtimeTransport } from "@/features/things/shared/multiplayer-realtime-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres multiplayer realtime transport", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("fans out one advisory wake across two dedicated listeners", async () => {
    const received: string[] = [];
    let resolveWake!: () => void;
    const wake = new Promise<void>((resolve) => {
      resolveWake = resolve;
    });
    const first = new PostgresMultiplayerRealtimeTransport(() => {});
    const second = new PostgresMultiplayerRealtimeTransport((payload) => {
      received.push(payload);
      resolveWake();
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.all([first.start(), second.start()]);
      const payload = JSON.stringify({
        channel: "things:centre:v1:room:ABC2345:events",
        message: '{"type":"wake"}',
        origin: "first-instance",
      });
      await first.publish(payload);
      await Promise.race([
        wake,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Postgres wake was not delivered")), 2_000);
        }),
      ]);
      expect(received).toEqual([payload]);
    } finally {
      if (timeout) clearTimeout(timeout);
      await Promise.all([first.close(), second.close()]);
    }
  });

  it("reconnects its listener after Postgres closes the connection", async () => {
    const received: string[] = [];
    const transport = new PostgresMultiplayerRealtimeTransport((payload) => received.push(payload));
    try {
      await transport.start();
      const listener = await query<{ pid: number }>(
        `select pid from pg_stat_activity
          where datname=current_database() and query='listen multiplayer_realtime_v1'
          order by backend_start desc limit 1`,
      );
      const originalPid = listener[0]?.pid;
      expect(originalPid).toBeDefined();
      await query("select pg_terminate_backend($1)", [originalPid]);

      let reconnected = false;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const current = await query<{ pid: number }>(
          `select pid from pg_stat_activity
            where datname=current_database() and query='listen multiplayer_realtime_v1'
              and pid<>$1 limit 1`,
          [originalPid],
        );
        if (current[0]) {
          reconnected = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(reconnected).toBe(true);
      await transport.publish("after-reconnect");
      for (let attempt = 0; attempt < 20 && received.length === 0; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toEqual(["after-reconnect"]);
    } finally {
      await transport.close();
    }
  });
});
