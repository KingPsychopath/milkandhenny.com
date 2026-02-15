import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testing the exported pure-ish functions from lib/blog.ts.
 *
 * extractHeadings is fully pure (string in, array out).
 * getPostBySlug, getAllPosts read from disk — we mock fs.
 */

// Mock fs before importing the module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import fs from "fs";
import { extractHeadings, getPostBySlug, getAllPosts } from "@/lib/blog";

const mockedFs = vi.mocked(fs);

describe("extractHeadings", () => {
  it("extracts h1, h2, h3 headings from markdown", () => {
    const md = `
# Introduction
Some text here.

## Getting Started
More text.

### Prerequisites
Even more text.

## Next Steps
`;
    const result = extractHeadings(md);
    expect(result).toEqual([
      { id: "introduction", label: "Introduction" },
      { id: "getting-started", label: "Getting Started" },
      { id: "prerequisites", label: "Prerequisites" },
      { id: "next-steps", label: "Next Steps" },
    ]);
  });

  it("ignores h4+ headings", () => {
    const md = `
# Title
#### This is h4 — ignored
## Subtitle
`;
    const result = extractHeadings(md);
    expect(result).toEqual([
      { id: "title", label: "Title" },
      { id: "subtitle", label: "Subtitle" },
    ]);
  });

  it("handles duplicate heading labels", () => {
    const md = `
## Setup
## Setup
## Setup
`;
    const result = extractHeadings(md);
    expect(result).toEqual([
      { id: "setup", label: "Setup" },
      { id: "setup-1", label: "Setup" },
      { id: "setup-2", label: "Setup" },
    ]);
  });

  it("returns empty array for no headings", () => {
    expect(extractHeadings("Just some text, no headings.")).toEqual([]);
  });
});

describe("getPostBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when file does not exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(getPostBySlug("nonexistent")).toBeNull();
  });

  it("parses frontmatter and calculates reading time", () => {
    mockedFs.existsSync.mockReturnValue(true);

    // ~230 words = 1 min reading time
    const words = Array(230).fill("word").join(" ");
    const markdown = `---
title: Test Post
date: "2026-01-15"
subtitle: A test
---

${words}`;

    mockedFs.readFileSync.mockReturnValue(markdown);

    const post = getPostBySlug("test-post");
    expect(post).not.toBeNull();
    expect(post!.title).toBe("Test Post");
    expect(post!.slug).toBe("test-post");
    expect(post!.subtitle).toBe("A test");
    expect(post!.readingTime).toBe(1);
  });

  it("rounds up reading time for short posts", () => {
    mockedFs.existsSync.mockReturnValue(true);

    const markdown = `---
title: Short
date: "2026-01-15"
---

Just a few words.`;

    mockedFs.readFileSync.mockReturnValue(markdown);

    const post = getPostBySlug("short");
    expect(post!.readingTime).toBe(1); // min 1 minute
  });

  it("defaults featured to false when not set", () => {
    mockedFs.existsSync.mockReturnValue(true);

    const markdown = `---
title: Normal Post
date: "2026-01-15"
---

Content.`;

    mockedFs.readFileSync.mockReturnValue(markdown);

    const post = getPostBySlug("normal-post");
    expect(post!.featured).toBe(false);
  });
});

describe("getAllPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when posts directory doesn't exist", () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(getAllPosts()).toEqual([]);
  });

  it("sorts posts by date descending (newest first)", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue([
      "old-post.md" as unknown as ReturnType<typeof fs.readdirSync>[0],
      "new-post.md" as unknown as ReturnType<typeof fs.readdirSync>[0],
    ]);

    mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
      const pathStr = String(filePath);
      if (pathStr.includes("old-post")) {
        return `---\ntitle: Old Post\ndate: "2025-01-01"\n---\nOld content.`;
      }
      return `---\ntitle: New Post\ndate: "2026-01-01"\n---\nNew content.`;
    });

    const posts = getAllPosts();
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe("New Post");
    expect(posts[1].title).toBe("Old Post");
  });
});
