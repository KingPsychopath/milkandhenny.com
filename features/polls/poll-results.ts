import type { PollOption, PollResult, PollSelectionMode } from "./types";

export function normalisePollOptions(value: unknown): PollOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? normaliseOptionId(item.id) : "",
      label: typeof item.label === "string" ? item.label.trim().slice(0, 80) : "",
    }))
    .filter((option) => {
      if (!option.id || !option.label || seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    })
    .slice(0, 12);
}

export function normaliseOptionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function validateSelections(
  options: readonly PollOption[],
  selectionMode: PollSelectionMode,
  value: unknown,
): string[] {
  if (!Array.isArray(value)) throw new Error("Choose an answer to continue");
  const available = new Set(options.map((option) => option.id));
  const selections = [...new Set(value.filter((item): item is string => typeof item === "string"))]
    .filter((item) => available.has(item))
    .slice(0, options.length);
  if (selections.length === 0) throw new Error("Choose an answer to continue");
  if (selectionMode === "single" && selections.length !== 1) {
    throw new Error("Choose one answer to continue");
  }
  return selections;
}

export function buildPollResults(
  options: readonly PollOption[],
  counts: Readonly<Record<string, number>>,
  responseCount: number,
): PollResult[] {
  const largest = Math.max(0, ...options.map((option) => counts[option.id] ?? 0));
  return options.map((option) => {
    const votes = Math.max(0, counts[option.id] ?? 0);
    return {
      ...option,
      votes,
      weight: largest > 0 ? votes / largest : 0,
      percentage: responseCount > 0 ? (votes / responseCount) * 100 : 0,
    };
  });
}
