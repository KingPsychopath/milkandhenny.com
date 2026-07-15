import { describe, expect, it } from "vitest";
import {
  deckNameFromText,
  formatDeckText,
  parseDeckText,
} from "../../features/things/heads-up/customDecks";

describe("custom decks", () => {
  it("cleans pasted Notes and Keep lists", () => {
    expect(parseDeckText("• Beyoncé\n2. The Moon\n☐ Sunday roast\n• beyoncé\n\nBig Ben")).toEqual([
      "Beyoncé",
      "The Moon",
      "Sunday roast",
      "Big Ben",
    ]);
  });

  it("round-trips the universal plain-text export", () => {
    const deck = { name: "Family favourites", cards: ["Nan", "The dog", "Benidorm"] };
    const text = formatDeckText(deck);

    expect(deckNameFromText(text)).toBe("Family favourites");
    expect(parseDeckText(text)).toEqual(deck.cards);
  });

  it("limits overly large lists and long cards", () => {
    const text = Array.from({ length: 205 }, (_, index) => `Card ${index} ${"x".repeat(90)}`).join(
      "\n",
    );
    const cards = parseDeckText(text);

    expect(cards).toHaveLength(200);
    expect(cards.every((card) => card.length <= 80)).toBe(true);
  });
});
