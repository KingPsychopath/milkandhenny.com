import { useCallback, useEffect, useState } from "react";
import { loadCustomDecks, storeCustomDecks, type CustomDeck } from "./customDecks";

export function useCustomDecks() {
  const [decks, setDecks] = useState<CustomDeck[]>([]);

  useEffect(() => setDecks(loadCustomDecks()), []);

  const saveDeck = useCallback(
    (deck: CustomDeck) => {
      const next = [...decks.filter((current) => current.id !== deck.id), deck];
      setDecks(next);
      storeCustomDecks(next);
    },
    [decks],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      const next = decks.filter((deck) => deck.id !== id);
      setDecks(next);
      storeCustomDecks(next);
    },
    [decks],
  );

  return { customDecks: decks, saveDeck, deleteDeck };
}
