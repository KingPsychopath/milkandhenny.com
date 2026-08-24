export const PRINT_LAYOUTS = {
  "full-page": { label: "One full-page poster", columns: 1, rows: 1 },
  "two-per-page": { label: "Two signs per page", columns: 1, rows: 2 },
  "four-per-page": { label: "Four cards per page", columns: 2, rows: 2 },
  "six-per-page": { label: "Six cards per page", columns: 2, rows: 3 },
  "eight-clues": { label: "Eight clue cards per page", columns: 2, rows: 4 },
  "twelve-small": { label: "Twelve small cards per page", columns: 3, rows: 4 },
  "a5-sign": { label: "A5 sign", columns: 1, rows: 1 },
  "table-tent": { label: "Folded table tent", columns: 1, rows: 2 },
  replacement: { label: "Individual replacement clue", columns: 1, rows: 1 },
} as const;

export type PrintLayout = keyof typeof PRINT_LAYOUTS;

export type PrintPackItem = {
  id: string;
  title: string;
  subtitle?: string;
  destination: string;
  fallbackCode: string;
  revision: number;
  private: boolean;
};

export type PrintPack = {
  eventSlug: string;
  title: string;
  subtitle?: string;
  paper: "a4" | "letter" | "a5" | "card";
  layout: PrintLayout;
  includePoints: boolean;
  includePlacementNotes: boolean;
  items: PrintPackItem[];
};

export function printLayout(value: unknown): value is PrintLayout {
  return typeof value === "string" && value in PRINT_LAYOUTS;
}

export function printPackPages(pack: Pick<PrintPack, "layout" | "items">): number {
  const layout = PRINT_LAYOUTS[pack.layout];
  return Math.max(1, Math.ceil(pack.items.length / (layout.columns * layout.rows)));
}

export function validatePrintPack(pack: PrintPack): string[] {
  const errors: string[] = [];
  if (!pack.eventSlug.trim()) errors.push("Event slug is required");
  if (!pack.title.trim()) errors.push("Event title is required");
  if (pack.items.length === 0) errors.push("At least one print item is required");
  const ids = new Set<string>();
  for (const item of pack.items) {
    if (ids.has(item.id)) errors.push(`Duplicate print item ${item.id}`);
    ids.add(item.id);
    if (!item.destination.startsWith("/"))
      errors.push(`Print item ${item.id} has an unsafe destination`);
    if (!item.fallbackCode.trim()) errors.push(`Print item ${item.id} has no fallback code`);
    if (!Number.isInteger(item.revision) || item.revision < 1)
      errors.push(`Print item ${item.id} has an invalid revision`);
    if (!item.private && /staff|admin|token|secret/i.test(item.destination)) {
      errors.push(`Public print item ${item.id} contains a private destination`);
    }
  }
  return errors;
}
