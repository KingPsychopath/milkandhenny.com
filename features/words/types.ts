export const WORD_TYPES = ["blog", "note", "recipe", "review"] as const;
export type WordType = (typeof WORD_TYPES)[number];
export const DEFAULT_WORD_TYPE: WordType = "note";

export type WordTypeMeta = {
  label: string;
  pluralLabel: string;
};

export const WORD_TYPE_META: Record<WordType, WordTypeMeta> = {
  blog: { label: "blog", pluralLabel: "blogs" },
  note: { label: "note", pluralLabel: "notes" },
  recipe: { label: "recipe", pluralLabel: "recipes" },
  review: { label: "review", pluralLabel: "reviews" },
};

export const WORD_TYPE_TABS: Array<WordType | "all"> = ["blog", "all", "recipe", "note", "review"];

export function isWordType(value: string): value is WordType {
  return WORD_TYPES.includes(value as WordType);
}

export function normaliseWordType(value: unknown): WordType {
  if (typeof value !== "string") return DEFAULT_WORD_TYPE;
  if (value === "post") return "blog"; // legacy alias
  return isWordType(value) ? value : DEFAULT_WORD_TYPE;
}

export function getWordTypeLabel(type: WordType | "all", options?: { plural?: boolean }): string {
  if (type === "all") return "all";
  const meta = WORD_TYPE_META[type];
  if (options?.plural) return meta.pluralLabel;
  return meta.label;
}
