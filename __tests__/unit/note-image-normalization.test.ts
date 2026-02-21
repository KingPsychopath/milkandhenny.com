import { describe, expect, it } from "vitest";
import { createNote, getNote, updateNote } from "@/features/notes/store";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe("note image normalization", () => {
  it("normalizes /hero.webp to hero.webp", async () => {
    const slug = uniqueSlug("img-normalize");
    await createNote({
      slug,
      title: "Image normalize",
      markdown: "body",
      image: "/hero.webp",
      type: "blog",
      visibility: "public",
    });

    const note = await getNote(slug);
    expect(note?.meta.image).toBe("hero.webp");
  });

  it("accepts markdown snippet in image field", async () => {
    const slug = uniqueSlug("img-markdown");
    await createNote({
      slug,
      title: "Image snippet",
      markdown: "body",
      image: "![hero](hero.webp)",
      type: "blog",
      visibility: "public",
    });

    const note = await getNote(slug);
    expect(note?.meta.image).toBe("hero.webp");
  });

  it("normalizes leading /words/media path on update", async () => {
    const slug = uniqueSlug("img-words-path");
    await createNote({
      slug,
      title: "Image words path",
      markdown: "body",
      image: "hero.webp",
      type: "blog",
      visibility: "public",
    });

    await updateNote(slug, {
      image: "/words/media/my-post/hero.webp",
    });

    const note = await getNote(slug);
    expect(note?.meta.image).toBe("words/media/my-post/hero.webp");
  });

  it("normalizes typed frontmatter image path to words/media", async () => {
    const slug = uniqueSlug("img-typed-path");
    await createNote({
      slug,
      title: "Typed image path",
      markdown: "body",
      image: "blog/on-being-featured/dsc00003.webp",
      type: "blog",
      visibility: "public",
    });

    const note = await getNote(slug);
    expect(note?.meta.image).toBe("words/media/on-being-featured/dsc00003.webp");
  });
});
