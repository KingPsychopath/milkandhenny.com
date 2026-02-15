import { describe, it, expect } from "vitest";
import { slug, uniqueHeadingIds } from "@/lib/slug";

describe("slug", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slug("Hello World")).toBe("hello-world");
  });

  it("strips non-alphanumeric chars except hyphens", () => {
    expect(slug("What's New? (v2.0)")).toBe("whats-new-v20");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slug("too   many    spaces")).toBe("too-many-spaces");
  });

  it("trims leading/trailing whitespace", () => {
    expect(slug("  padded  ")).toBe("padded");
  });

  it("returns empty string for symbol-only input", () => {
    expect(slug("!@#$%")).toBe("");
  });

  it("handles already-slugified text", () => {
    expect(slug("already-slugified")).toBe("already-slugified");
  });

  it("handles emoji-only input", () => {
    expect(slug("🎉🎊")).toBe("");
  });

  it("handles mixed case with numbers", () => {
    expect(slug("Step 1: Getting Started")).toBe("step-1-getting-started");
  });
});

describe("uniqueHeadingIds", () => {
  it("returns slugified ids for unique labels", () => {
    const result = uniqueHeadingIds(["Introduction", "Getting Started"]);
    expect(result).toEqual([
      { id: "introduction", label: "Introduction" },
      { id: "getting-started", label: "Getting Started" },
    ]);
  });

  it("appends -1, -2, etc. for duplicate labels", () => {
    const result = uniqueHeadingIds(["Setup", "Setup", "Setup"]);
    expect(result).toEqual([
      { id: "setup", label: "Setup" },
      { id: "setup-1", label: "Setup" },
      { id: "setup-2", label: "Setup" },
    ]);
  });

  it("falls back to 'section' for empty slug", () => {
    const result = uniqueHeadingIds(["!!!"]);
    expect(result).toEqual([{ id: "section", label: "!!!" }]);
  });

  it("handles mix of unique and duplicate labels", () => {
    const result = uniqueHeadingIds(["Intro", "Setup", "Intro"]);
    expect(result).toEqual([
      { id: "intro", label: "Intro" },
      { id: "setup", label: "Setup" },
      { id: "intro-1", label: "Intro" },
    ]);
  });

  it("handles empty array", () => {
    expect(uniqueHeadingIds([])).toEqual([]);
  });
});
