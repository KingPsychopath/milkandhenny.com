import { useCallback, useEffect, useState } from "react";

import { familyFeudBrowserKeys } from "./family-feud-keys";
import type { FamilyFeudCustomDeckInput } from "./types";

function parseDecks(value: string | null): FamilyFeudCustomDeckInput[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as FamilyFeudCustomDeckInput[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function useFamilyFeudCustomDecks() {
  const [decks, setDecks] = useState<FamilyFeudCustomDeckInput[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setDecks(parseDecks(localStorage.getItem(familyFeudBrowserKeys.customDecks())));
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
