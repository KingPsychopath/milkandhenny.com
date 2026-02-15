import { describe, it, expect } from "vitest";

/**
 * Contract test: extractHeadings (blog.ts) and rehypeSlug (rehype-slug.ts)
 * MUST produce the same IDs for the same headings.
 *
 * If they drift, the JumpRail TOC links won't scroll to the right heading.
 * This test enforces the contract documented in slug.ts:
 *   "Must match the logic used in rehype-slug so TOC links line up."
 */

import { extractHeadings } from "@/lib/blog";
import { rehypeSlug } from "@/lib/rehype-slug";

type TextNode = { type: "text"; value: string };
type ElementNode = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: (TextNode | ElementNode)[];
};
type RootNode = { type: "root"; children: ElementNode[] };

/** Build a minimal hast tree from heading labels (simulating what remark → rehype produces) */
function buildHastTree(headings: { level: number; text: string }[]): RootNode {
  return {
    type: "root",
    children: headings.map(({ level, text }) => ({
      type: "element" as const,
      tagName: `h${level}`,
      properties: {},
      children: [{ type: "text" as const, value: text }],
    })),
  };
}

/** Build a markdown string from heading labels */
function buildMarkdown(headings: { level: number; text: string }[]): string {
  return headings.map(({ level, text }) => `${"#".repeat(level)} ${text}`).join("\n\n");
}

describe("extractHeadings ↔ rehypeSlug contract", () => {
  const TEST_CASES = [
    {
      name: "simple unique headings",
      headings: [
        { level: 1, text: "Introduction" },
        { level: 2, text: "Getting Started" },
        { level: 3, text: "Prerequisites" },
      ],
    },
    {
      name: "duplicate headings get -1, -2 suffixes",
      headings: [
        { level: 2, text: "Setup" },
        { level: 2, text: "Setup" },
        { level: 2, text: "Setup" },
      ],
    },
    {
      name: "special characters stripped identically",
      headings: [
        { level: 2, text: "What's New? (v2.0)" },
        { level: 2, text: "Step 1: Configure" },
        { level: 3, text: "FAQ & Tips" },
      ],
    },
    {
      name: "mixed duplicates and unique",
      headings: [
        { level: 1, text: "Photos" },
        { level: 2, text: "Upload" },
        { level: 2, text: "Photos" },
        { level: 3, text: "Upload" },
      ],
    },
  ];

  for (const { name, headings } of TEST_CASES) {
    it(`produces matching IDs: ${name}`, () => {
      // Side A: extractHeadings parses markdown → returns { id, label }[]
      const markdown = buildMarkdown(headings);
      const blogIds = extractHeadings(markdown).map((h) => h.id);

      // Side B: rehypeSlug transforms hast tree → assigns id to each heading
      const tree = buildHastTree(headings);
      const plugin = rehypeSlug();
      plugin(tree);
      const rehypeIds = tree.children.map(
        (node) => node.properties.id as string
      );

      // They must match — this is the contract
      expect(blogIds).toEqual(rehypeIds);
    });
  }
});
