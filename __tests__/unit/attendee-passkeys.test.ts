import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateSession: vi.fn(),
  ensureSession: vi.fn(),
  getSession: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  sendSecurityNotice: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
}));

vi.mock("@/features/attendee-access/session.server", () => ({
  authenticateAttendeeSession: mocks.authenticateSession,
  ensureAttendeeSession: mocks.ensureSession,
  getAttendeeSession: mocks.getSession,
  revokeAttendeeSessionsForPerson: vi.fn(),
}));

vi.mock("@/lib/platform/postgres.server", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  transaction: vi.fn(),
}));

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/shared/config", () => ({
  getBaseUrlForRequest: () => "https://milkandhenny.com",
  SITE_NAME: "Milk & Henny",
}));
vi.mock("@/features/attendee-access/access.server", () => ({
  requestFingerprint: () => "request-fingerprint",
}));
vi.mock("@/features/attendee-access/security-notifications.server", () => ({
  sendPersonSecurityNotice: mocks.sendSecurityNotice,
}));

import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
} from "@/features/attendee-access/passkeys.server";

const PERSON_ID = "01990d56-65b8-7e17-9ce7-0fb7a2824b12";
const SESSION = {
  id: "attendee-session-1",
  personId: PERSON_ID,
  authenticatedAt: new Date().toISOString(),
};

describe("attendee passkey registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    mocks.ensureSession.mockResolvedValue(SESSION);
    mocks.getSession.mockResolvedValue(SESSION);
    mocks.query.mockResolvedValue([]);
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "registration-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "credential-1",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    });
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("select canonical_name")) return { canonical_name: "Existing person" };
      if (sql.includes("select user_handle")) return null;
      if (sql.includes("insert into person_webauthn_profiles")) {
        return { user_handle: "A".repeat(43) };
      }
      if (sql.includes("insert into person_passkeys")) {
        return {
          id: "01990d56-b1f6-74d2-8196-9a2867d939d5",
          person_id: PERSON_ID,
          credential_id: "credential-1",
          public_key: Buffer.from([1, 2, 3]),
          counter: 0,
          transports: ["internal"],
          device_type: "multiDevice",
          backed_up: true,
          label: "Laptop passkey",
          created_at: new Date("2026-08-26T12:00:00.000Z"),
          last_used_at: null,
        };
      }
      return null;
    });
  });

  it("creates a single-use ceremony and persists the verified credential", async () => {
    const started = await beginPasskeyRegistration(new Request("https://milkandhenny.com/my"));
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(started.value.ceremonyId).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "milkandhenny.com",
        userName: "A".repeat(43),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      }),
    );

    const finished = await finishPasskeyRegistration({
      ceremonyId: started.value.ceremonyId,
      label: "  Laptop   passkey  ",
      response: {
        id: "credential-1",
        rawId: "credential-1",
        response: {
          attestationObject: "AA",
          clientDataJSON: "AA",
          transports: ["internal"],
          publicKeyAlgorithm: -7,
          publicKey: "AA",
          authenticatorData: "AA",
        },
        type: "public-key",
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      },
    });

    expect(finished).toEqual({
      ok: true,
      value: {
        passkey: {
          id: "01990d56-b1f6-74d2-8196-9a2867d939d5",
          label: "Laptop passkey",
          createdAt: "2026-08-26T12:00:00.000Z",
          backedUp: true,
          deviceType: "multiDevice",
        },
      },
    });
    expect(mocks.authenticateSession).toHaveBeenCalledWith({
      personId: PERSON_ID,
      method: "passkey",
      passkeyId: "01990d56-b1f6-74d2-8196-9a2867d939d5",
    });
    expect(mocks.sendSecurityNotice).toHaveBeenCalledWith(
      expect.objectContaining({ personId: PERSON_ID, subject: "A passkey was added" }),
    );

    await expect(
      finishPasskeyRegistration({
        ceremonyId: started.value.ceremonyId,
        label: "Laptop passkey",
        response: {
          id: "credential-1",
          rawId: "credential-1",
          response: {
            attestationObject: "AA",
            clientDataJSON: "AA",
          },
          type: "public-key",
          clientExtensionResults: {},
        },
      }),
    ).resolves.toMatchObject({ ok: false, status: 400 });
  });
});
