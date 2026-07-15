import type { GameDeck } from "./decks";

export interface CustomDeck {
  id: string;
  name: string;
  cards: string[];
  updatedAt: number;
}

const STORAGE_KEY = "forehead.custom-decks.v1";
const MAX_CARDS = 200;
const MAX_CARD_LENGTH = 80;

export function parseDeckText(value: string) {
  const lines = value
    .split(/\r?\n/)
    .filter((line) => !/^\s*forehead deck:/i.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^(?:[-*•◦▪☐☑✓]|\d+[.)])\s*/, "")
        .trim(),
    )
    .filter(Boolean);

  const seen = new Set<string>();
  const cards: string[] = [];
  for (const line of lines) {
    const card = line.slice(0, MAX_CARD_LENGTH).trim();
    const key = card.toLocaleLowerCase();
    if (!card || seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
    if (cards.length === MAX_CARDS) break;
  }
  return cards;
}

export function deckNameFromText(value: string) {
  return (
    value
      .match(/^\s*forehead deck:\s*(.+)$/im)?.[1]
      ?.trim()
      .slice(0, 50) ?? null
  );
}

export function formatDeckText(deck: Pick<CustomDeck, "name" | "cards">) {
  return [`Forehead deck: ${deck.name}`, "", ...deck.cards].join("\n");
}

export function customDeckAsGameDeck(deck: CustomDeck): GameDeck {
  return {
    id: deck.id,
    name: deck.name,
    description: "Your deck · saved on this device.",
    symbol: "✎",
    cards: deck.cards,
  };
}

export function createCustomDeck(name: string, cards: string[], existingId?: string): CustomDeck {
  return {
    id: existingId ?? `custom-${crypto.randomUUID()}`,
    name: name.trim().slice(0, 50) || "My deck",
    cards: cards.slice(0, MAX_CARDS),
    updatedAt: Date.now(),
  };
}

export function loadCustomDecks() {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): CustomDeck[] => {
      if (!item || typeof item !== "object") return [];
      const deck = item as Partial<CustomDeck>;
      if (
        typeof deck.id !== "string" ||
        typeof deck.name !== "string" ||
        !Array.isArray(deck.cards)
      ) {
        return [];
      }
      const cards = deck.cards.filter((card): card is string => typeof card === "string");
      if (cards.length < 3) return [];
      return [
        {
          id: deck.id,
          name: deck.name.slice(0, 50),
          cards: cards.slice(0, MAX_CARDS).map((card) => card.slice(0, MAX_CARD_LENGTH)),
          updatedAt: typeof deck.updatedAt === "number" ? deck.updatedAt : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function storeCustomDecks(decks: CustomDeck[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}
