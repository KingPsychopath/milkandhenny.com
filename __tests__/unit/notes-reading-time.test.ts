import { describe, expect, it } from "vitest";
import { createWord, getWordMeta, updateWord } from "@/features/words/store";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i + 1}`).join(" ");
}

describe("notes reading time", () => {
  it("stores reading time from markdown on create", async () => {
    const slug = uniqueSlug("reading-create");
    await createWord({
      slug,
      title: "Reading Time Create",
      markdown: words(460),
      type: "blog",
      visibility: "public",
    });

    const meta = await getWordMeta(slug);
    expect(meta).not.toBeNull();
    expect(meta?.readingTime).toBe(2);
  });

  it("updates reading time when markdown changes", async () => {
    const slug = uniqueSlug("reading-update");
    await createWord({
      slug,
      title: "Reading Time Update",
      markdown: words(460),
      type: "note",
      visibility: "private",
    });

    await updateWord(slug, { markdown: words(20) });
    const meta = await getWordMeta(slug);
    expect(meta).not.toBeNull();
    expect(meta?.readingTime).toBe(1);
  });
});
