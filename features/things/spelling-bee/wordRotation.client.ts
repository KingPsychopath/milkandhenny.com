import { shuffledWords, type SpellingWord } from "./decks";

const keyFor = (deckId: string) => `things:spelling-bee:v2:deck:${encodeURIComponent(deckId)}:recent-words`;

export function readRecentSpellingWordIds(deckId: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(keyFor(deckId)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

export function selectSpellingRoundWords(deckId: string, words: readonly SpellingWord[], requestedCount: number) {
  const count = Math.max(1, Math.min(words.length, requestedCount));
  const recent = new Set(readRecentSpellingWordIds(deckId));
  const fresh = shuffledWords(words.filter(({ id }) => !recent.has(id)));
  const previouslyUsed = shuffledWords(words.filter(({ id }) => recent.has(id)));
  return [...fresh, ...previouslyUsed].slice(0, count);
}

export function rememberSpellingWords(deckId: string, selectedWordIds: readonly string[], deckWordCount: number) {
  const keep = Math.max(0, deckWordCount - selectedWordIds.length);
  if (keep === 0) {
    localStorage.removeItem(keyFor(deckId));
    return;
  }
  const next = [...readRecentSpellingWordIds(deckId), ...selectedWordIds].filter((id, index, values) => values.lastIndexOf(id) === index).slice(-keep);
  localStorage.setItem(keyFor(deckId), JSON.stringify(next));
}
