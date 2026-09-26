import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  cleanupPostgresPasskeyCeremonies,
  storePostgresPasskeyCeremony,
  takePostgresPasskeyCeremony,
} from "@/features/attendee-access/passkey-ceremony-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres passkey ceremonies", () => {
  beforeAll(async () => {
    vi.stubEnv("PASSKEY_CEREMONY_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-passkey-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate attendee_passkey_ceremonies");
  });

  it("stores a hashed lookup and permits one concurrent take", async () => {
    const id = "abcdefghijklmnopqrstuvwx";
    const value = { type: "authentication", challenge: "secret-challenge" };
    expect(await storePostgresPasskeyCeremony(id, value)).toBe(true);
    expect(await storePostgresPasskeyCeremony(id, value)).toBe(false);
    const stored = await query<{ id_hash: string }>(
      "select id_hash from attendee_passkey_ceremonies",
    );
    expect(stored[0]?.id_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored[0]?.id_hash).not.toBe(id);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => takePostgresPasskeyCeremony(id)),
    );
    expect(attempts.filter(Boolean)).toEqual([value]);
    expect(await takePostgresPasskeyCeremony(id)).toBeNull();
  });

  it("rejects expired ceremonies and cleans them in bounded batches", async () => {
    const id = "1234567890abcdefghijklmn";
    expect(await storePostgresPasskeyCeremony(id, { challenge: "expired" })).toBe(true);
    await query("update attendee_passkey_ceremonies set expires_at = now() - interval '1 second'");
    expect(await takePostgresPasskeyCeremony(id)).toBeNull();
    expect(await cleanupPostgresPasskeyCeremonies(1)).toBe(1);
  });
});
