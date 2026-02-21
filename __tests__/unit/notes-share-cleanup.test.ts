import { describe, expect, it } from "vitest";
import {
  cleanupShareLinksForSlug,
  createShareLink,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
} from "@/features/notes/share";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("notes share cleanup", () => {
  it("removes expired and revoked links while preserving active ones", async () => {
    const slug = uniqueSlug("cleanup-mixed");
    const active = await createShareLink({ slug, pinRequired: false, expiresInDays: 7 });
    const expired = await createShareLink({ slug, pinRequired: false, expiresInDays: 1 });
    const revoked = await createShareLink({ slug, pinRequired: false, expiresInDays: 7 });
    await revokeShareLink(slug, revoked.link.id);

    const nowMs = Date.now() + 2 * 86400 * 1000;
    const result = await cleanupShareLinksForSlug(slug, nowMs);
    expect(result.removedExpired).toBeGreaterThanOrEqual(1);
    expect(result.removedRevoked).toBeGreaterThanOrEqual(1);

    const links = await listShareLinks(slug);
    const ids = new Set(links.map((link) => link.id));
    expect(ids.has(active.link.id)).toBe(true);
    expect(ids.has(expired.link.id)).toBe(false);
    expect(ids.has(revoked.link.id)).toBe(false);
  });

  it("removes slug from tracked cleanup set when no links remain", async () => {
    const slug = uniqueSlug("cleanup-empty");
    await createShareLink({ slug, pinRequired: false, expiresInDays: 1 });

    const nowMs = Date.now() + 2 * 86400 * 1000;
    const result = await cleanupShareLinksForSlug(slug, nowMs);
    expect(result.remaining).toBe(0);

    const tracked = await listTrackedShareSlugs();
    expect(tracked.includes(slug)).toBe(false);
  });
});
