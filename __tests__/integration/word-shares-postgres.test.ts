import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createWord, deleteWord } from "@/features/words/store.server";
import {
  cleanupShareLinksForSlug,
  createShareLink,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
  signWordAccessToken,
  updateShareLink,
  verifyShareLinkAccess,
  verifyWordAccessToken,
} from "@/features/words/share.server";
import {
  savePostgresShare,
  ShareRevisionConflictError,
} from "@/features/words/share-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres word shares", () => {
  beforeAll(async () => {
    vi.stubEnv("WORD_STORE", "postgres");
    vi.stubEnv("WORD_SHARE_STORE", "postgres");
    vi.stubEnv("RATE_LIMIT_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "word-share-integration-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate words cascade");
    await query("truncate rate_limit_windows cascade");
    await createWord({ slug: "shared-word", title: "Shared", markdown: "Private" });
  });

  it("preserves PIN, token rotation, revocation and parent deletion", async () => {
    const created = await createShareLink({ slug: "shared-word", pinRequired: true, pin: "1234" });
    expect(created.link.revision).toBe(1);
    expect((await listShareLinks("shared-word")).map(({ id }) => id)).toEqual([created.link.id]);
    expect(await listTrackedShareSlugs()).toContain("shared-word");
    const wrong = await verifyShareLinkAccess({
      slug: "shared-word",
      token: created.token,
      pin: "9999",
      ip: "192.0.2.1",
    });
    expect(wrong.ok).toBe(false);
    const accepted = await verifyShareLinkAccess({
      slug: "shared-word",
      token: created.token,
      pin: "1234",
      ip: "192.0.2.1",
    });
    expect(accepted.ok).toBe(true);
    const cookie = signWordAccessToken(created.link);
    if (!cookie) throw new Error("Expected signed cookie");
    expect(await verifyWordAccessToken("shared-word", cookie)).toBe(true);

    const rotated = await updateShareLink("shared-word", created.link.id, { rotateToken: true });
    expect(rotated?.link.revision).toBe(2);
    expect(await verifyWordAccessToken("shared-word", cookie)).toBe(false);
    expect(
      (
        await verifyShareLinkAccess({
          slug: "shared-word",
          token: rotated?.token ?? "",
          pin: "1234",
          ip: "192.0.2.1",
        })
      ).ok,
    ).toBe(true);
    expect(await revokeShareLink("shared-word", created.link.id)).toBe(true);
    expect(await verifyWordAccessToken("shared-word", cookie)).toBe(false);
    expect(await deleteWord("shared-word")).toBe(true);
    expect(await listTrackedShareSlugs()).toEqual([]);
  });

  it("refuses a stale edit and removes expired links", async () => {
    const created = await createShareLink({ slug: "shared-word" });
    const changed = await updateShareLink("shared-word", created.link.id, { expiresInDays: 2 });
    expect(changed?.link.revision).toBe(2);
    await expect(savePostgresShare(created.link)).rejects.toBeInstanceOf(
      ShareRevisionConflictError,
    );
    await query("update word_share_links set expires_at = now() - interval '1 second'");
    const cleanup = await cleanupShareLinksForSlug("shared-word");
    expect(cleanup).toMatchObject({ scanned: 1, removedExpired: 1, remaining: 0 });
    expect(await listShareLinks("shared-word")).toEqual([]);
  });
});
