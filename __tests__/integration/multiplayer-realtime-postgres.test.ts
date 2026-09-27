import { afterAll, beforeAll, expect, it } from "vitest";

import { PostgresMultiplayerRealtimeTransport } from "@/features/things/shared/multiplayer-realtime-postgres.server";
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
});
