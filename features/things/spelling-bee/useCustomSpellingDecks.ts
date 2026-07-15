import { useCallback, useEffect, useState } from "react";
import { loadCustomSpellingDecks, storeCustomSpellingDecks, type CustomSpellingDeck } from "./customDecks";

export function useCustomSpellingDecks() {
  const [decks, setDecks] = useState<CustomSpellingDeck[]>([]);
  useEffect(() => {
    let active = true;
    void loadCustomSpellingDecks().then((value) => { if (active) setDecks(value); });
    return () => { active = false; };
  }, []);
  const saveDeck = useCallback((deck: CustomSpellingDeck) => {
    setDecks((current) => {
      const next = [...current.filter(({ id }) => id !== deck.id), deck];
      void storeCustomSpellingDecks(next);
      return next;
    });
  }, []);
  const deleteDeck = useCallback((id: string) => {
    setDecks((current) => {
      const next = current.filter((deck) => deck.id !== id);
      void storeCustomSpellingDecks(next);
      return next;
    });
  }, []);
  return { customDecks: decks, saveDeck, deleteDeck };
}
