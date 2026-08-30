import { describe, expect, it } from "vitest";

import {
  FAMILY_FEUD_DECKS,
  FAMILY_FEUD_VIBES,
  familyFeudDeck,
  familyFeudRoundDeckSequence,
} from "@/features/things/family-feud/family-feud-content";
import {
  familyFeudActiveTeam,
  familyFeudAnswerMatches,
  familyFeudBoardValue,
  familyFeudPlacements,
  normaliseFamilyFeudAnswer,
  validateFamilyFeudCard,
} from "@/features/things/family-feud/family-feud-rules";

describe("Family Feud rules and decks", () => {
  it("ships original ten-answer cards in every built-in deck", () => {
    expect(FAMILY_FEUD_DECKS).toHaveLength(11);
    expect(FAMILY_FEUD_DECKS.reduce((total, deck) => total + deck.cardCount, 0)).toBe(76);
    let adaptedCards = 0;
    for (const summary of FAMILY_FEUD_DECKS) {
      const deck = familyFeudDeck(summary.id);
      expect(deck.cards).toHaveLength(summary.cardCount);
      expect(deck.cards.every(validateFamilyFeudCard)).toBe(true);
      expect(new Set(deck.cards.map(({ id }) => id)).size).toBe(deck.cards.length);
      adaptedCards += deck.cards.filter(
        ({ provenance }) => provenance?.kind === "protoqa-adapted",
      ).length;
    }
    expect(adaptedCards).toBe(8);
  });

  it("builds six-round vibe arcs without adjacent deck repeats", () => {
    for (const vibe of FAMILY_FEUD_VIBES.filter(({ id }) => id !== "choose-own")) {
      const sequence = familyFeudRoundDeckSequence({
        vibeId: vibe.id,
        includeAdult: false,
        rounds: 6,
      });
      expect(sequence).toHaveLength(6);
      expect(sequence).not.toContain("slightly-spicy");
      expect(sequence.every((deckId, index) => index === 0 || deckId !== sequence[index - 1])).toBe(
        true,
      );
      if (vibe.id !== "after-dark") expect(new Set(sequence).size).toBeGreaterThanOrEqual(4);
    }
    const afterDark = familyFeudRoundDeckSequence({
      vibeId: "after-dark",
      includeAdult: true,
      rounds: 6,
    });
    expect(afterDark.filter((deckId) => deckId === "slightly-spicy")).toHaveLength(1);
    expect(afterDark.indexOf("slightly-spicy")).toBeGreaterThanOrEqual(4);
  });

  it("normalises spoken aliases without fuzzy or subjective matching", () => {
    const card = familyFeudDeck("everyday-life").cards[0]!;
    const phone = card.answers.find(({ label }) => label === "A mobile phone")!;
    expect(familyFeudAnswerMatches(phone, "  CELL-phone! ")).toBe(true);
    expect(familyFeudAnswerMatches(phone, "tablet")).toBe(false);
    expect(normaliseFamilyFeudAnswer("Café’s Wi-Fi")).toBe("cafes wi fi");
  });

  it("alternates main teams and assigns competition placements", () => {
    expect(Array.from({ length: 10 }, (_, index) => familyFeudBoardValue(index + 1))).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(familyFeudBoardValue(0)).toBe(0);
    expect(familyFeudBoardValue(11)).toBe(0);
    expect([1, 2, 3, 4].map((round) => familyFeudActiveTeam(round, "one"))).toEqual([
      "one",
      "two",
      "one",
      "two",
    ]);
    expect(familyFeudPlacements({ one: 8, two: 5 })).toEqual({
      one: { placement: 1, won: true },
      two: { placement: 2, won: false },
    });
    expect(familyFeudPlacements({ one: 5, two: 5 })).toEqual({
      one: { placement: 1, won: true },
      two: { placement: 1, won: true },
    });
  });
});
