import { readThingData, writeThingData } from "@/features/offline/storage";
import type { SpellingDeck, SpellingWord } from "./decks";

export interface CustomSpellingDeck {
  id: string;
  name: string;
  words: SpellingWord[];
  updatedAt: number;
}

const STORAGE_KEY = "spelling-bee:custom-decks";
const STORAGE_VERSION = 1;
const MAX_WORDS = 200;

export function parseSpellingWords(value: string) {
  const seen = new Set<string>();
  const words: SpellingWord[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.replace(/^(?:[-*•◦▪]|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const [rawWord, partOfSpeech, definition, speakAs, sentence] = line.split("|").map((part) => part.trim());
    const spelling = rawWord.slice(0, 80);
    const key = spelling.toLocaleLowerCase();
    if (!spelling || seen.has(key)) continue;
    seen.add(key);
    words.push({
      id: `custom-word-${crypto.randomUUID()}`,
      word: spelling,
      partOfSpeech: partOfSpeech?.slice(0, 30) || undefined,
      definition: definition?.slice(0, 220) || undefined,
      speakAs: speakAs?.slice(0, 100) || undefined,
      sentence: sentence?.slice(0, 240) || undefined,
    });
    if (words.length === MAX_WORDS) break;
  }
  return words;
}

export function formatSpellingWords(words: readonly SpellingWord[]) {
  return words
    .map((item) => {
      const fields = [item.word, item.partOfSpeech ?? "", item.definition ?? "", item.speakAs ?? "", item.sentence ?? ""];
      while (fields.at(-1) === "") fields.pop();
      return fields.join(" | ");
    })
    .join("\n");
}

function normalise(value: unknown): CustomSpellingDeck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CustomSpellingDeck[] => {
    if (!item || typeof item !== "object") return [];
    const deck = item as Partial<CustomSpellingDeck>;
    if (typeof deck.id !== "string" || typeof deck.name !== "string" || !Array.isArray(deck.words)) return [];
    const words = deck.words.flatMap((candidate): SpellingWord[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const entry = candidate as Partial<SpellingWord>;
      if (typeof entry.word !== "string" || !entry.word.trim()) return [];
      return [{
        id: typeof entry.id === "string" ? entry.id : `custom-word-${crypto.randomUUID()}`,
        word: entry.word.slice(0, 80),
        partOfSpeech: typeof entry.partOfSpeech === "string" ? entry.partOfSpeech.slice(0, 30) : undefined,
        definition: typeof entry.definition === "string" ? entry.definition.slice(0, 220) : undefined,
        speakAs: typeof entry.speakAs === "string" ? entry.speakAs.slice(0, 100) : undefined,
        sentence: typeof entry.sentence === "string" ? entry.sentence.slice(0, 240) : undefined,
      }];
    }).slice(0, MAX_WORDS);
    if (words.length < 3) return [];
    return [{ id: deck.id, name: deck.name.slice(0, 50), words, updatedAt: typeof deck.updatedAt === "number" ? deck.updatedAt : 0 }];
  });
}

export async function loadCustomSpellingDecks() {
  try {
    return normalise((await readThingData(STORAGE_KEY))?.value);
  } catch {
    return [];
  }
}

export async function storeCustomSpellingDecks(decks: CustomSpellingDeck[]) {
  await writeThingData(STORAGE_KEY, STORAGE_VERSION, decks);
}

export function createCustomSpellingDeck(name: string, words: SpellingWord[], id?: string): CustomSpellingDeck {
  return { id: id ?? `spelling-custom-${crypto.randomUUID()}`, name: name.trim().slice(0, 50) || "My words", words: words.slice(0, MAX_WORDS), updatedAt: Date.now() };
}

export function customSpellingDeckAsDeck(deck: CustomSpellingDeck): SpellingDeck {
  return { id: deck.id, name: deck.name, description: "Your words · saved on this device.", symbol: "✎", words: deck.words };
}
