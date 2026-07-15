import type { GameDeck } from "./decks";
import { readThingData, writeThingData } from "@/features/offline/storage";
import { THING_OFFLINE } from "@/features/things/offline";

export interface CustomDeck {
  id: string;
  name: string;
  cards: string[];
  updatedAt: number;
}

const LEGACY_STORAGE_KEY = "forehead.custom-decks.v1";
const STORAGE_KEY = "heads-up:custom-decks";
const STORAGE_VERSION = THING_OFFLINE["heads-up"].storageVersion;
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

function normaliseCustomDecks(value: unknown) {
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
}

function loadLegacyCustomDecks() {
  try {
    return normaliseCustomDecks(
      JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? "[]"),
    );
  } catch {
    return [];
  }
}

export async function loadCustomDecks() {
  const legacy = loadLegacyCustomDecks();
  try {
    const record = await readThingData(STORAGE_KEY);
    if (record) {
      if (record.schemaVersion > STORAGE_VERSION) return [];
      const decks = normaliseCustomDecks(record.value);
      if (record.schemaVersion < STORAGE_VERSION) {
        await writeThingData(STORAGE_KEY, STORAGE_VERSION, decks);
      }
      return decks;
    }
    if (legacy.length > 0) {
      await writeThingData(STORAGE_KEY, STORAGE_VERSION, legacy);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // IndexedDB can be unavailable in private modes; retain the legacy fallback.
  }
  return legacy;
}

export async function storeCustomDecks(decks: CustomDeck[]) {
  try {
    await writeThingData(STORAGE_KEY, STORAGE_VERSION, decks);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(decks));
  }
}
