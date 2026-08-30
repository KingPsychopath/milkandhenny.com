import { uniqueHeadingIds } from "@/lib/markdown/slug";

export type HeadingItem = { id: string; label: string };

export function extractHeadings(content: string): HeadingItem[] {
  const labels: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of content.split(/\r?\n/)) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const run = fenceMatch[1];
      const marker = run[0] as "`" | "~";
      if (!fence) {
        fence = { marker, length: run.length };
      } else if (fence.marker === marker && run.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const heading = line.match(/^ {0,3}#{1,3}[\t ]+(.+?)[\t ]*#*[\t ]*$/);
    if (heading) labels.push(heading[1].trim());
  }
  return uniqueHeadingIds(labels);
}
