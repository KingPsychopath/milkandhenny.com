import { useCallback, useEffect, useState } from "react";

import { familyFeudBrowserKeys } from "./family-feud-keys";
import { validateFamilyFeudCard } from "./family-feud-rules";
import type { FamilyFeudCardDefinition } from "./types";
import type { FamilyFeudCustomDeckInput } from "./types";

function storedCard(value: unknown): FamilyFeudCardDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.prompt !== "string" ||
    !Array.isArray(candidate.answers) ||
    candidate.answers.length !== 10
  )
    return null;
  const answers = candidate.answers.map((value) => {
    if (!value || typeof value !== "object") return null;
    const answer = value as Record<string, unknown>;
    if (
      typeof answer.id !== "string" ||
      typeof answer.label !== "string" ||
      !Array.isArray(answer.aliases) ||
      !answer.aliases.every((alias) => typeof alias === "string")
    )
      return null;
    return {
      id: answer.id.slice(0, 120),
      label: answer.label.slice(0, 56),
      aliases: answer.aliases.slice(0, 8).map((alias) => alias.slice(0, 56)),
    };
  });
  if (answers.some((answer) => answer === null)) return null;
  const card: FamilyFeudCardDefinition = {
    id: candidate.id.slice(0, 100),
    prompt: candidate.prompt.slice(0, 140),
    answers: answers as FamilyFeudCardDefinition["answers"],
  };
  return validateFamilyFeudCard(card) ? card : null;
}

export function parseFamilyFeudCustomDecks(value: string | null): FamilyFeudCustomDeckInput[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 20)
      .map((value) => {
        if (!value || typeof value !== "object") return null;
        const deck = value as Record<string, unknown>;
        if (
          typeof deck.id !== "string" ||
          !deck.id.trim() ||
          typeof deck.name !== "string" ||
          !deck.name.trim() ||
          !Array.isArray(deck.cards)
        )
          return null;
        const cards = deck.cards
          .slice(0, 80)
          .map(storedCard)
          .filter((card) => card !== null);
        if (cards.length < 4) return null;
        return {
          id: deck.id.slice(0, 100),
          name: deck.name.slice(0, 48),
          cards,
        } satisfies FamilyFeudCustomDeckInput;
      })
      .filter((deck) => deck !== null);
  } catch {
    return [];
  }
}

export function useFamilyFeudCustomDecks() {
  const [decks, setDecks] = useState<FamilyFeudCustomDeckInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDecks(parseFamilyFeudCustomDecks(localStorage.getItem(familyFeudBrowserKeys.customDecks())));
    setLoaded(true);
  }, []);
  const persist = useCallback((next: FamilyFeudCustomDeckInput[]) => {
    setDecks(next);
    localStorage.setItem(familyFeudBrowserKeys.customDecks(), JSON.stringify(next));
  }, []);
  const save = useCallback(
    (deck: FamilyFeudCustomDeckInput) =>
      persist([...decks.filter(({ id }) => id !== deck.id), deck].slice(-20)),
    [decks, persist],
  );
  const remove = useCallback(
    (deckId: string) => persist(decks.filter(({ id }) => id !== deckId)),
    [decks, persist],
  );
  return { decks, loaded, save, remove };
}
