import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { consumeActionLink } from "@/features/attendee-operations/action-links.server";
import { allowPitchRecovery } from "@/features/things/pitches/pitches.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres feature throttles", () => {
  beforeAll(async () => {
    vi.stubEnv("RATE_LIMIT_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-feature-rate-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate rate_limit_windows, attendee_action_links cascade");
  });

  it("bounds repeated action-link redemption attempts", async () => {
    const attempts = [];
    for (let index = 0; index < 13; index += 1) {
      attempts.push(await consumeActionLink("invalid-token", async () => true));
    }
    expect(attempts.slice(0, 12).every((result) => !result.ok && result.status === 404)).toBe(true);
    expect(attempts[12]).toEqual({
      ok: false,
      status: 429,
      error: "Too many attempts. Try again later.",
    });
  });

  it("bounds Pitch recovery while hiding the email in the rate table", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => allowPitchRecovery("127.0.0.1", "Ada@Example.Test")),
    );
    expect(attempts.filter(Boolean)).toHaveLength(4);
    const rows = await query<{ subject_hash: string }>(
      "select subject_hash from rate_limit_windows where policy = 'pitches-recover'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.subject_hash).not.toContain("Ada");
  });
});
