import { describe, expect, it } from "vitest";
import { createWord, deleteWord } from "@/features/words/store";
import { createShareLink, listShareLinks, listTrackedShareSlugs } from "@/features/words/share";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("note delete share cleanup", () => {
  it("deletes share records and index tracking when note is deleted", async () => {
    const slug = uniqueSlug("delete-share");

    await createWord({
      slug,
      title: "Delete Share Cleanup",
      markdown: "test",
      type: "note",
      visibility: "private",
    });
    await createShareLink({ slug, pinRequired: false, expiresInDays: 7 });

    expect((await listShareLinks(slug)).length).toBeGreaterThan(0);
    expect((await listTrackedShareSlugs()).includes(slug)).toBe(true);

    const deleted = await deleteWord(slug);
    expect(deleted).toBe(true);
    expect(await listShareLinks(slug)).toHaveLength(0);
    expect((await listTrackedShareSlugs()).includes(slug)).toBe(false);
  });
});
