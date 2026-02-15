/**
 * Slugify a heading label for use as an id (anchor).
 * Must match the logic used in rehype-slug so TOC links line up.
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Return unique ids for a list of labels in order.
 * Duplicates get -1, -2, etc. so TOC and rehype-slug stay in sync.
 */
export function uniqueHeadingIds(labels: string[]): { id: string; label: string }[] {
  const used = new Set<string>();
  return labels.map((label) => {
    let base = slug(label) || "section";
    let id = base;
    let n = 1;
    while (used.has(id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    used.add(id);
    return { id, label };
  });
}
