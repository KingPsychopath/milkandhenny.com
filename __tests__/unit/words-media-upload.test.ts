import { describe, expect, it } from "vitest";
import {
  mediaPrefixForTarget,
  parseWordMediaTarget,
  toMarkdownSnippetForTarget,
  toR2Filename,
} from "@/features/words/upload";

describe("words media upload helpers", () => {
  it("defaults to word scope and normalizes slug", () => {
    const parsed = parseWordMediaTarget({ slug: " My-Post " });
    expect(parsed).toEqual({
      ok: true,
      target: { scope: "word", slug: "my-post" },
    });
  });

  it("parses asset scope and normalizes asset id", () => {
    const parsed = parseWordMediaTarget({ scope: "asset", assetId: " Brand-Kit " });
    expect(parsed).toEqual({
      ok: true,
      target: { scope: "asset", assetId: "brand-kit" },
    });
  });

  it("rejects invalid target ids", () => {
    const parsed = parseWordMediaTarget({ scope: "asset", assetId: "not valid" });
    expect(parsed.ok).toBe(false);
  });

  it("builds media prefixes for word and asset targets", () => {
    expect(mediaPrefixForTarget({ scope: "word", slug: "hello" })).toBe("words/media/hello/");
    expect(mediaPrefixForTarget({ scope: "asset", assetId: "brand-kit" })).toBe(
      "words/assets/brand-kit/"
    );
  });

  it("converts processable images to webp filenames", () => {
    expect(toR2Filename("Hero Image.JPG")).toBe("hero-image.webp");
  });

  it("preserves extension for non-image files", () => {
    expect(toR2Filename("Pricing.PDF")).toBe("pricing.pdf");
  });

  it("creates image markdown snippets for word-scoped media", () => {
    expect(
      toMarkdownSnippetForTarget({ scope: "word", slug: "launch-notes" }, "hero.webp", "image")
    ).toBe("![hero](words/media/launch-notes/hero.webp)");
  });

  it("creates link markdown snippets for shared non-image assets", () => {
    expect(
      toMarkdownSnippetForTarget(
        { scope: "asset", assetId: "brand-kit" },
        "logo.svg",
        "file"
      )
    ).toBe("[logo](words/assets/brand-kit/logo.svg)");
  });
});
