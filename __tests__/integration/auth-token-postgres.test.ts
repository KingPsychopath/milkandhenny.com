import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { revokeCurrentSession } from "@/features/auth/internal/authorization.server";
import {
  cleanupPostgresTokenState,
  getPostgresRecentLogin,
  getPostgresRoleVersion,
  incrementPostgresRoleVersion,
  listPostgresTokenSessions,
} from "@/features/auth/internal/token-state-postgres.server";
import {
  loginDedupeKey,
  registerTokenSession,
  signToken,
  verifyToken,
} from "@/features/auth/internal/token-session.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres auth token state", () => {
  beforeAll(async () => {
    vi.stubEnv("AUTH_TOKEN_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-auth-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query(
      "truncate auth_recent_logins, auth_revoked_tokens, auth_token_sessions, auth_role_token_versions",
    );
  });

  it("registers, lists, deduplicates and revokes a token without Redis", async () => {
    const token = await signToken("admin");
    expect(token).toBeTruthy();
    if (!token) return;
    const dedupeKey = loginDedupeKey("admin", "127.0.0.1", "test-agent");
    expect(
      await registerTokenSession(
        token,
        { ip: "127.0.0.1", ua: "test-agent", source: "browser" },
        dedupeKey,
      ),
    ).toBe(true);
    expect(await getPostgresRecentLogin(dedupeKey)).toBe(token);
    const sealed = await query<{ token_ciphertext: Buffer }>(
      "select token_ciphertext from auth_recent_logins",
    );
    expect(sealed[0]?.token_ciphertext.toString("utf8")).not.toContain(token);
    const payload = await verifyToken(token, "admin");
    expect(payload?.jti).toBeTruthy();
    const listing = await listPostgresTokenSessions(10);
    expect(listing.totalIndexed).toBe(1);
    expect(listing.sessions[0]?.status).toBe("active");
    expect(listing.sessions[0]?.source).toBe("browser");
    const request = new Request("https://example.test/logout", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await revokeCurrentSession(request, "admin")).toBe(true);
    expect(await verifyToken(token, "admin")).toBeNull();
    expect((await listPostgresTokenSessions(10)).sessions[0]?.status).toBe("revoked");
  });

  it("increments role versions atomically and invalidates earlier tokens", async () => {
    const token = await signToken("upload");
    expect(token).toBeTruthy();
    if (!token) return;
    const versions = await Promise.all(
      Array.from({ length: 8 }, () => incrementPostgresRoleVersion("upload")),
    );
    expect(new Set(versions).size).toBe(8);
    expect(await getPostgresRoleVersion("upload")).toBe(9);
    expect(await verifyToken(token, "upload")).toBeNull();
    const current = await signToken("upload");
    expect(current).toBeTruthy();
    if (current) expect((await verifyToken(current, "upload"))?.tv).toBe(9);
  });

  it("does not overwrite an existing JTI or a revoked token", async () => {
    const token = await signToken("admin");
    expect(token).toBeTruthy();
    if (!token) return;
    const metadata = { ip: "127.0.0.1", ua: "test", source: "cli" as const };
    expect(await registerTokenSession(token, metadata)).toBe(true);
    expect(await registerTokenSession(token, metadata)).toBe(false);
    const listed = await listPostgresTokenSessions(1);
    expect(listed.sessions).toHaveLength(1);
  });

  it("cleans only expired state in bounded batches", async () => {
    const token = await signToken("admin");
    expect(token).toBeTruthy();
    if (!token) return;
    const dedupeKey = loginDedupeKey("admin", "127.0.0.1", "cleanup");
    expect(
      await registerTokenSession(
        token,
        { ip: "127.0.0.1", ua: "cleanup", source: "browser" },
        dedupeKey,
      ),
    ).toBe(true);
    await query(
      "update auth_token_sessions set issued_at = now() - interval '62 days', expires_at = now() - interval '61 days'",
    );
    await query("update auth_recent_logins set expires_at = now() - interval '1 day'");
    await query(
      "insert into auth_revoked_tokens (jti, expires_at) values ('expired-test', now() - interval '1 day')",
    );
    expect(await cleanupPostgresTokenState(1)).toEqual({
      skipped: false,
      sessions: 1,
      revocations: 1,
      recentLogins: 1,
    });
    expect((await listPostgresTokenSessions(10)).sessions).toHaveLength(0);
  });
});
