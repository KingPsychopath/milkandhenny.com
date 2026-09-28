import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  approveCliAuthorization,
  createCliAuthorizationRequest,
  denyCliAuthorization,
  exchangeCliAuthorizationCode,
  getCliAuthorizationRequest,
} from "@/features/auth/cli-auth.server";
import { cleanupPostgresCliAuth } from "@/features/auth/cli-auth-postgres.server";
import { verifyStepUpToken } from "@/features/auth/internal/authorization.server";
import { verifyToken } from "@/features/auth/internal/token-session.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function request(purpose: "login" | "step-up" = "login") {
  return createCliAuthorizationRequest({
    redirectUri: "http://127.0.0.1:45678/callback",
    codeChallenge: challenge,
    state: "s".repeat(32),
    ip: "127.0.0.1",
    ua: "test-cli",
    browserUrlOrigin: "https://milkandhenny.com",
    purpose,
    ...(purpose === "step-up" ? { parentJti: "parent-session" } : {}),
  });
}

describeWithDatabase("Postgres CLI authorization", () => {
  beforeAll(async () => {
    vi.stubEnv("AUTH_CLI_STORE", "postgres");
    vi.stubEnv("AUTH_TOKEN_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-cli-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query(
      "truncate auth_cli_codes, auth_cli_requests, auth_recent_logins, auth_revoked_tokens, auth_token_sessions, auth_role_token_versions",
    );
  });

  it("approves once, recovers the redirect and consumes the PKCE code once", async () => {
    const pending = await request();
    expect(pending?.requestId).toBeTruthy();
    if (!pending) return;
    expect((await getCliAuthorizationRequest(pending.requestId))?.purpose).toBe("login");
    const approvals = await Promise.all(
      Array.from({ length: 3 }, () => approveCliAuthorization(pending.requestId)),
    );
    expect(approvals.every((value) => value?.redirectUri === approvals[0]?.redirectUri)).toBe(true);
    expect(await getCliAuthorizationRequest(pending.requestId)).toBeNull();
    const code = new URL(approvals[0]?.redirectUri ?? "").searchParams.get("code");
    expect(code).toBeTruthy();
    expect(await query("select 1 from auth_cli_codes")).toHaveLength(1);
    expect(await query("select 1 from auth_token_sessions")).toHaveLength(1);
    expect(
      await exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: "x".repeat(43) }),
    ).toBeNull();
    const exchanges = await Promise.all(
      Array.from({ length: 3 }, () =>
        exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: verifier }),
      ),
    );
    expect(exchanges.filter(Boolean)).toHaveLength(1);
    expect((await verifyToken(exchanges.find(Boolean) ?? "", "admin"))?.role).toBe("admin");
    const sealed = await query<{ token_ciphertext: Buffer }>(
      "select token_ciphertext from auth_cli_codes",
    );
    expect(sealed[0]?.token_ciphertext.toString("utf8")).not.toContain(exchanges.find(Boolean));
  });

  it("denial wins the decision race and issues no code", async () => {
    const pending = await request();
    if (!pending) throw new Error("CLI request failed");
    const denied = await denyCliAuthorization(pending.requestId);
    expect(new URL(denied?.redirectUri ?? "").searchParams.get("error")).toBe("access_denied");
    expect(await approveCliAuthorization(pending.requestId)).toEqual(denied);
    expect(await query("select 1 from auth_cli_codes")).toHaveLength(0);
  });

  it("binds a one-time step-up token to the parent CLI session", async () => {
    const pending = await request("step-up");
    if (!pending) throw new Error("CLI request failed");
    const approved = await approveCliAuthorization(pending.requestId);
    const code = new URL(approved?.redirectUri ?? "").searchParams.get("code");
    const token = await exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: verifier });
    expect(token).toBeTruthy();
    expect(verifyStepUpToken(token ?? "", "parent-session")).toBe(true);
    expect(verifyStepUpToken(token ?? "", "another-session")).toBe(false);
    expect(
      await exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: verifier }),
    ).toBeNull();
  });

  it("rolls back JWT registration when code creation fails", async () => {
    const pending = await request();
    if (!pending) throw new Error("CLI request failed");
    await query("alter table auth_cli_codes add constraint block_cli_codes_for_test check (false)");
    try {
      expect(await approveCliAuthorization(pending.requestId)).toBeNull();
      expect(await query("select 1 from auth_token_sessions")).toHaveLength(0);
      expect(await getCliAuthorizationRequest(pending.requestId)).not.toBeNull();
    } finally {
      await query("alter table auth_cli_codes drop constraint block_cli_codes_for_test");
    }
  });

  it("rejects expired requests and codes, then cleans them", async () => {
    const pending = await request();
    if (!pending) throw new Error("CLI request failed");
    await query("update auth_cli_requests set expires_at = now() - interval '1 second'");
    expect(await approveCliAuthorization(pending.requestId)).toBeNull();
    const live = await request("step-up");
    if (!live) throw new Error("CLI request failed");
    const approved = await approveCliAuthorization(live.requestId);
    const code = new URL(approved?.redirectUri ?? "").searchParams.get("code");
    await query("update auth_cli_codes set expires_at = now() - interval '1 second'");
    expect(
      await exchangeCliAuthorizationCode({ code: code ?? "", codeVerifier: verifier }),
    ).toBeNull();
    const cleaned = await cleanupPostgresCliAuth(10);
    expect(cleaned.requests).toBe(1);
    expect(cleaned.codes).toBe(1);
  });
});
