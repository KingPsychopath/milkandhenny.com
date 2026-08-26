import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Secret, TOTP } from "otpauth";

process.env.AUTH_SECRET = "totp-authentication-test-secret-at-least-32";

const sessionState = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  completions: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/features/attendee-access/security-notifications.server", () => ({
  sendPersonSecurityNotice: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/event-scoring/session.server", () => ({
  getAttendeeSession: async () => sessionState.current,
  pendingMfaIsFresh: (pending: { createdAt?: string } | undefined) => {
    const createdAt = pending?.createdAt ? Date.parse(pending.createdAt) : Number.NaN;
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 10 * 60 * 1_000;
  },
  completeAttendeeMfaSession: async (input: Record<string, unknown>) => {
    sessionState.completions.push(input);
    const pending = sessionState.current?.pendingMfa as { personId?: string } | undefined;
    return pending?.personId ? { ...sessionState.current, personId: pending.personId } : null;
  },
  stepUpAttendeeSession: async (input: Record<string, unknown>) => {
    sessionState.completions.push(input);
    return sessionState.current;
  },
  revokeAttendeeSessionsForPerson: vi.fn().mockResolvedValue(1),
}));

import {
  beginTotpEnrollment,
  finishTotpEnrollment,
  verifyPendingRecoveryCode,
  verifyPendingTotp,
} from "@/features/attendee-access/totp.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const PERSON = "0198e9d8-53d7-7dbb-ad72-d7d18d3bb7d2";

describeWithDatabase("TOTP authentication (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await truncateAll();
    await query(`insert into event_people (id,canonical_name) values ($1,'TOTP Person')`, [PERSON]);
    await query(
      `insert into event_person_identifiers
         (person_id,kind,value_hash,email_address,verified_at)
       values ($1,'email',$2,'totp@example.test',now())`,
      [PERSON, "a".repeat(64)],
    );
    sessionState.current = {
      id: "enrollment-session",
      personId: PERSON,
      authenticatedAt: new Date().toISOString(),
    };
    sessionState.completions = [];
  });

  it("encrypts enrollment secrets and rejects replayed TOTP and recovery codes", async () => {
    const begun = await beginTotpEnrollment();
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const authenticator = new TOTP({
      issuer: "milk & henny",
      label: "TOTP Person",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(begun.value.secret),
    });
    const enrolled = await finishTotpEnrollment({
      enrollmentId: begun.value.enrollmentId,
      token: authenticator.generate(),
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.value.recoveryCodes).toHaveLength(10);
    const stored = await query<{ secret_ciphertext: string }>(
      `select secret_ciphertext from person_totp_authenticators where person_id = $1`,
      [PERSON],
    );
    expect(stored[0]?.secret_ciphertext).toMatch(/^v1\./);
    expect(stored[0]?.secret_ciphertext).not.toContain(begun.value.secret);

    sessionState.current = {
      id: "totp-without-email-proof",
      personId: PERSON,
      authenticatedAt: new Date().toISOString(),
    };
    await expect(verifyPendingTotp(authenticator.generate())).resolves.toMatchObject({
      ok: false,
      status: 401,
    });

    const pending = {
      id: "pending-totp-session",
      pendingMfa: {
        personId: PERSON,
        verifiedEmailHash: "a".repeat(64),
        returnTo: "/my",
        createdAt: new Date().toISOString(),
      },
    };
    const nextToken = authenticator.generate({ timestamp: Date.now() + 30_000 });
    sessionState.current = pending;
    await expect(verifyPendingTotp(nextToken)).resolves.toMatchObject({ ok: true });
    sessionState.current = { ...pending, id: "pending-totp-replay" };
    await expect(verifyPendingTotp(nextToken)).resolves.toMatchObject({ ok: false, status: 401 });

    const recoveryCode = enrolled.value.recoveryCodes[0]!;
    sessionState.current = { ...pending, id: "pending-recovery-session" };
    await expect(verifyPendingRecoveryCode(recoveryCode)).resolves.toMatchObject({
      ok: true,
      value: { recoveryCodesRemaining: 9 },
    });
    sessionState.current = { ...pending, id: "pending-recovery-replay" };
    await expect(verifyPendingRecoveryCode(recoveryCode)).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });
});
