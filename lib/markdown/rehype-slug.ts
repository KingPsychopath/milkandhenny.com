/** Minimal hast-like types to match rehype-hashtags */
type TextNode = { type: "text"; value: string };
type ElementNode = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: UnistNode[];
};
type RootNode = { type: "root"; children: UnistNode[] };
type UnistNode = TextNode | ElementNode | RootNode;

const HEADING_TAGS = ["h1", "h2", "h3"];

function getTextContent(node: UnistNode): string {
  if (node.type === "text") return node.value ?? "";
  if ("children" in node)
    return (node as ElementNode).children.map(getTextContent).join("");
  return "";
}

function visit(
  node: UnistNode,
  root: RootNode,
  usedIds: Set<string>,
  slug: (t: string) => string
): void {
  if (
    node.type === "element" &&
    HEADING_TAGS.includes(node.tagName) &&
    node.properties
  ) {
    const text = getTextContent(node).trim();
    const base = slug(text) || "section";
    let id = base;
    let n = 1;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    usedIds.add(id);
    node.properties.id = id;
    return;
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) visit(child, root, usedIds, slug);
  }
}

import { slug as slugify } from "./slug";

/**
 * Rehype plugin: add id to h1, h2, h3 from heading text (slug).
 * Duplicate slugs get -1, -2, etc. so anchors match extractHeadings.
 */
export function rehypeSlug() {
  return function transformer(tree: UnistNode) {
    if (tree.type === "root" && Array.isArray(tree.children)) {
      const usedIds = new Set<string>();
      for (const child of tree.children) {
        visit(child, tree, usedIds, slugify);
      }
    }
  };
}
