import { describe, expect, it } from "vitest";
import { createNote, getNote, updateNote } from "@/features/notes/store";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("note markdown normalization", () => {
  it("normalizes relative media refs to words/media/{slug}", async () => {
    const slug = uniqueSlug("md-media");
    await createNote({
      slug,
      title: "Markdown media refs",
      markdown: "![hero](hero.webp)\n\n![cover](images/cover.webp)",
      type: "blog",
      visibility: "private",
    });

    const note = await getNote(slug);
    expect(note?.markdown).toContain(`![hero](words/media/${slug}/hero.webp)`);
    expect(note?.markdown).toContain(`![cover](words/media/${slug}/images/cover.webp)`);
  });

  it("normalizes assets shorthand and typed refs", async () => {
    const slug = uniqueSlug("md-assets");
    await createNote({
      slug,
      title: "Markdown assets refs",
      markdown: "![logo](assets/brand-kit/logo.webp)\n\n![hero](blog/shared-post/hero.webp)",
      type: "blog",
      visibility: "private",
    });

    const note = await getNote(slug);
    expect(note?.markdown).toContain("![logo](words/assets/brand-kit/logo.webp)");
    expect(note?.markdown).toContain("![hero](words/media/shared-post/hero.webp)");
  });

  it("preserves non-file and internal route links", async () => {
    const slug = uniqueSlug("md-links");
    await createNote({
      slug,
      title: "Markdown links",
      markdown: "[about](/about)\n\n[pics](/pics/milk-and-henny-jan-2026#masonry)",
      type: "blog",
      visibility: "private",
    });

    const note = await getNote(slug);
    expect(note?.markdown).toContain("[about](/about)");
    expect(note?.markdown).toContain("[pics](/pics/milk-and-henny-jan-2026#masonry)");
  });

  it("normalizes markdown when updating a note", async () => {
    const slug = uniqueSlug("md-update");
    await createNote({
      slug,
      title: "Markdown update",
      markdown: "start",
      type: "blog",
      visibility: "private",
    });

    await updateNote(slug, {
      markdown: "![hero](/hero.webp)\n\n![asset](/assets/shared/icon.webp)",
    });

    const note = await getNote(slug);
    expect(note?.markdown).toContain(`![hero](words/media/${slug}/hero.webp)`);
    expect(note?.markdown).toContain("![asset](words/assets/shared/icon.webp)");
  });
});

