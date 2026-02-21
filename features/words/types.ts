export const WORD_TYPES = ["blog", "note", "recipe", "review"] as const;
export type WordType = (typeof WORD_TYPES)[number];

export function isWordType(value: string): value is WordType {
  return WORD_TYPES.includes(value as WordType);
}

export function normaliseWordType(value: unknown): WordType {
  if (typeof value !== "string") return "note";
  if (value === "post") return "blog"; // legacy alias
  return isWordType(value) ? value : "note";
}
