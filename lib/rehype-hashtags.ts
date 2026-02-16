/** Minimal hast-like types so we don't depend on @types/hast */
type TextNode = { type: "text"; value: string };
type ElementNode = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: UnistNode[];
};
type RootNode = { type: "root"; children: UnistNode[] };
type UnistNode = TextNode | ElementNode | RootNode;

/** Walk tree and replace text nodes that contain #hashtags with mixed content */
function visit(
  node: UnistNode,
  parent: (ElementNode | RootNode) | null,
  index: number
): void {
  if (node.type === "text" && parent && /#\w+/.test(node.value)) {
    const parts = node.value.split(/(#\w+)/g);
    const newNodes: UnistNode[] = parts.map((part) => {
      if (part.startsWith("#")) {
        return {
          type: "element",
          tagName: "span",
          properties: { className: ["prose-hashtag"] },
          children: [{ type: "text", value: part }],
        };
      }
      return { type: "text", value: part };
    });
    parent.children.splice(index, 1, ...newNodes);
    return;
  }

  if ("children" in node && Array.isArray(node.children)) {
    const el = node as ElementNode;
    if (
      el.type === "element" &&
      el.tagName === "span" &&
      Array.isArray(el.properties?.className) &&
      el.properties.className.includes("prose-hashtag")
    ) {
      return;
    }
    let i = 0;
    while (i < node.children.length) {
      visit(node.children[i], node as ElementNode | RootNode, i);
      i++;
    }
  }
}

/**
 * Rehype plugin: wrap #hashtags in text with <span class="prose-hashtag">.
 */
export function rehypeHashtags() {
  return function transformer(tree: UnistNode) {
    if (tree.type === "root" && Array.isArray(tree.children)) {
      let i = 0;
      while (i < tree.children.length) {
        visit(tree.children[i], tree, i);
        i++;
      }
    }
  };
}
