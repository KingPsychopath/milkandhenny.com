export interface SpellingDeckPickerItem {
  id: string;
  name: string;
  description: string;
  symbol: string;
  wordCount: number;
}

export function SpellingDeckPicker({
  decks,
  selectedDeckId,
  customDeckIds,
  onSelectDeck,
  onCreateDeck,
  onEditDeck,
}: {
  decks: SpellingDeckPickerItem[];
  selectedDeckId: string;
  customDeckIds: Set<string>;
  onSelectDeck: (id: string) => void;
  onCreateDeck: () => void;
  onEditDeck: (id: string) => void;
}) {
  return (
    <section className="mx-auto mt-10 max-w-lg" aria-labelledby="spelling-decks">
      <div className="flex min-h-11 items-center justify-between gap-4">
        <h2 id="spelling-decks" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">choose words</h2>
        <button type="button" onClick={onCreateDeck} className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs">+ make a deck</button>
      </div>
      <div className="mt-3 grid gap-3">
        {decks.map((deck) => {
          const selected = deck.id === selectedDeckId;
          return (
            <div key={deck.id} className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-3xl border p-2 ${selected ? "border-white/60 bg-white/12" : "border-white/12 bg-white/[0.04]"}`}>
              <button type="button" onClick={() => onSelectDeck(deck.id)} aria-pressed={selected} className="grid min-h-20 grid-cols-[2.75rem_1fr_auto] items-center gap-3 p-2 text-left">
                <span aria-hidden="true" className="font-serif text-2xl text-white/60">{deck.symbol}</span>
                <span><span className="block font-serif text-xl font-semibold">{deck.name}</span><span className="mt-1 block text-xs leading-relaxed text-white/50">{deck.description}</span></span>
                <span className="font-mono text-xs text-white/40">{deck.wordCount} words</span>
              </button>
              {customDeckIds.has(deck.id) ? <button type="button" onClick={() => onEditDeck(deck.id)} className="min-h-11 rounded-full px-3 font-mono text-xs text-white/55">edit</button> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
