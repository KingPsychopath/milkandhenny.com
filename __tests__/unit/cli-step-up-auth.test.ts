import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createRedisMock() {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (values.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: unknown, options?: { nx?: boolean }): Promise<"OK" | null> {
      if (options?.nx && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<number> {
      return values.delete(key) ? 1 : 0;
    },
  };
}

describe("CLI browser step-up", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AUTH_SECRET: "test-secret-key-for-jwt-signing-1234567890-EXTRA-LENGTH",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("mints a one-time step-up token bound to the requesting CLI session", async () => {
    const redis = createRedisMock();
    vi.doMock("@/lib/platform/redis.server", () => ({ getRedis: () => redis }));
    vi.doMock("@/features/auth/auth.server", () => ({
      issueAdminTokenForCli: vi.fn(() => {
        throw new Error("login token issuance should not run for step-up");
      }),
    }));

    const verifier = "v".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const parentJti = "cli-session-a";
    const { approveCliAuthorization, createCliAuthorizationRequest, exchangeCliAuthorizationCode } =
      await import("@/features/auth/cli-auth.server");
    const { verifyStepUpToken } = await import("@/features/auth/internal/authorization.server");

    const authorization = await createCliAuthorizationRequest({
      redirectUri: "http://127.0.0.1:45678/callback",
      codeChallenge: challenge,
      state: "s".repeat(32),
      ip: "127.0.0.1",
      ua: "test-cli",
      browserUrlOrigin: "https://milkandhenny.com",
      purpose: "step-up",
      parentJti,
    });
    expect(authorization).not.toBeNull();

    const approval = await approveCliAuthorization(authorization?.requestId ?? "");
    const code = new URL(approval?.redirectUri ?? "http://invalid").searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await exchangeCliAuthorizationCode({
      code: code ?? "",
      codeVerifier: verifier,
    });
    expect(token).toBeTruthy();
    expect(verifyStepUpToken(token ?? "", parentJti)).toBe(true);
    expect(verifyStepUpToken(token ?? "", "cli-session-b")).toBe(false);
    await expect(
      exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: verifier }),
    ).resolves.toBeNull();
  });
});
