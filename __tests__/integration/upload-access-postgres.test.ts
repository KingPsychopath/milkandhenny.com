import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  authenticateUploadAccess,
  closeUploadAccess,
  getUploadAccessStatus,
  getUploadAccessWindow,
  openUploadAccess,
  UPLOAD_ACCESS_COOKIE,
} from "@/features/auth/upload-access.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

function requestWithCookie(token: string): Request {
  return new Request("https://example.test/upload", {
    headers: { cookie: `${UPLOAD_ACCESS_COOKIE}=${token}` },
  });
}

describeWithDatabase("Postgres upload access windows", () => {
  beforeAll(async () => {
    vi.stubEnv("UPLOAD_ACCESS_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-upload-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate upload_access_window, upload_access_audit");
  });

  it("reissues an encrypted token and denies it after close", async () => {
    const opened = await openUploadAccess(15);
    expect(opened?.token).toBeTruthy();
    if (!opened) return;
    const stored = await query<{ token_ciphertext: Buffer; token_nonce: Buffer }>(
      "select token_ciphertext, token_nonce from upload_access_window",
    );
    expect(stored[0]?.token_ciphertext.toString("utf8")).not.toContain(opened.token);
    expect(stored[0]?.token_nonce).toHaveLength(12);
    expect((await getUploadAccessWindow())?.token).toBe(opened.token);
    expect((await authenticateUploadAccess(requestWithCookie(opened.token)))?.window.id).toBe(
      opened.id,
    );
    expect(await authenticateUploadAccess(requestWithCookie("wrong-token"))).toBeNull();

    expect(await closeUploadAccess()).toBe(true);
    expect(await authenticateUploadAccess(requestWithCookie(opened.token))).toBeNull();
    const status = await getUploadAccessStatus();
    expect(status.active).toBe(false);
    expect(status.audit.map((event) => event.action)).toEqual(["closed", "opened"]);
  });

  it("treats an expired window as closed without extending access", async () => {
    const opened = await openUploadAccess(60);
    expect(opened).not.toBeNull();
    await query(
      "update upload_access_window set opened_at = clock_timestamp() - interval '1 hour', expires_at = clock_timestamp() - interval '1 second'",
    );
    expect(await getUploadAccessWindow()).toBeNull();
    expect(await closeUploadAccess()).toBe(true);
    expect((await getUploadAccessStatus()).audit.map((event) => event.action)).toEqual(["opened"]);
  });

  it("serializes concurrent openings and keeps the last 20 audit events", async () => {
    const opened = await Promise.all(Array.from({ length: 4 }, () => openUploadAccess(15)));
    const current = await getUploadAccessWindow();
    expect(current).not.toBeNull();
    expect(opened.some((window) => window?.token === current?.token)).toBe(true);
    for (const window of opened) {
      if (!window) continue;
      const auth = await authenticateUploadAccess(requestWithCookie(window.token));
      expect(Boolean(auth)).toBe(window.token === current?.token);
    }
    for (let index = 0; index < 18; index += 1) await openUploadAccess(15);
    expect((await getUploadAccessStatus()).audit).toHaveLength(20);
    expect(await query("select 1 from upload_access_audit")).toHaveLength(20);
  });
});
