import { shuffledCards } from "./decks";

/**
 * Cards this device has already played, per deck, so back-to-back rounds feel like a new game
 * rather than the same dozen names again. Mirrors the spelling word rotation.
 */
const keyFor = (deckId: string) =>
  `things:forehead:v1:deck:${encodeURIComponent(deckId)}:recent-cards`;

export function readRecentCards(deckId: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(keyFor(deckId)) ?? "[]");
    return Array.isArray(value)
      ? value.filter((card): card is string => typeof card === "string").slice(-400)
      : [];
  } catch {
    return [];
  }
}

/**
 * Unseen cards first, then the ones seen longest ago. A round never runs out: once the deck is
 * exhausted the previously played cards come back, oldest first, still shuffled among themselves.
 */
export function selectRoundCards(deckId: string, cards: readonly string[]) {
  const recent = readRecentCards(deckId);
  const seen = new Set(recent);
  const fresh = shuffledCards(cards.filter((card) => !seen.has(card)));
  const staleFirst = recent.filter((card) => cards.includes(card));
  const repeats = [
    ...staleFirst,
    ...shuffledCards(cards.filter((card) => seen.has(card) && !staleFirst.includes(card))),
  ];
  return [...fresh, ...repeats];
}

export function rememberCards(deckId: string, playedCards: readonly string[], deckSize: number) {
  if (playedCards.length === 0) return;
  // Keeping strictly fewer than the deck size guarantees there is always something unseen to
  // deal next round, so the history can never wedge into a fixed order.
  const keep = Math.max(0, deckSize - 1);
  if (keep === 0) {
    localStorage.removeItem(keyFor(deckId));
    return;
  }
  const next = [...readRecentCards(deckId), ...playedCards]
    .filter((card, index, values) => values.lastIndexOf(card) === index)
    .slice(-keep);
  localStorage.setItem(keyFor(deckId), JSON.stringify(next));
}
