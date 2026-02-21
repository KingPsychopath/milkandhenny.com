import { uniqueHeadingIds } from "@/lib/markdown/slug";

export type HeadingItem = { id: string; label: string };

export function extractHeadings(content: string): HeadingItem[] {
  const labels: string[] = [];
  const lineRe = /^(#{1,3})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(content)) !== null) {
    labels.push(match[2].trim());
  }
  return uniqueHeadingIds(labels);
}
