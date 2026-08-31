import { describe, expect, it } from "vitest";

import { familyFeudDeck } from "@/features/things/family-feud/family-feud-content";
import { parseFamilyFeudCustomDecks } from "@/features/things/family-feud/family-feud-custom-decks.client";

describe("Family Feud custom deck storage", () => {
  it("keeps valid decks and drops malformed browser data", () => {
    const cards = familyFeudDeck("everyday-life").cards.slice(0, 4);
    const parsed = parseFamilyFeudCustomDecks(
      JSON.stringify([
        { id: "custom:valid", name: "Our room", cards },
        { id: "custom:broken", name: "Broken", cards: [{ prompt: 42 }] },
        null,
      ]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "custom:valid", name: "Our room" });
    expect(parsed[0]?.cards).toHaveLength(4);
  });

  it("does not revive cards with duplicate answers", () => {
    const cards = familyFeudDeck("everyday-life")
      .cards.slice(0, 4)
      .map((card) => ({
        ...card,
        answers: card.answers.map((answer) => ({ ...answer })),
      }));
    cards[0]!.answers[1]!.label = cards[0]!.answers[0]!.label;

    expect(
      parseFamilyFeudCustomDecks(
        JSON.stringify([{ id: "custom:duplicate", name: "Duplicate", cards }]),
      ),
    ).toEqual([]);
  });
});
