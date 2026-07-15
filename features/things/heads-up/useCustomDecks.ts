import { useCallback, useEffect, useState } from "react";
import { loadCustomDecks, storeCustomDecks, type CustomDeck } from "./customDecks";

export function useCustomDecks() {
  const [decks, setDecks] = useState<CustomDeck[]>([]);

  useEffect(() => {
    let active = true;
    void loadCustomDecks().then((stored) => {
      if (active) setDecks(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  const saveDeck = useCallback(
    (deck: CustomDeck) => {
      const next = [...decks.filter((current) => current.id !== deck.id), deck];
      setDecks(next);
      void storeCustomDecks(next);
    },
    [decks],
  );

  const deleteDeck = useCallback(
    (id: string) => {
      const next = decks.filter((deck) => deck.id !== id);
      setDecks(next);
      void storeCustomDecks(next);
    },
    [decks],
  );

  return { customDecks: decks, saveDeck, deleteDeck };
}
