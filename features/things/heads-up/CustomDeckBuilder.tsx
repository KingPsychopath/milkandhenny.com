import { useEffect, useMemo, useRef, useState } from "react";
import { createCustomDeck, deckNameFromText, parseDeckText, type CustomDeck } from "./customDecks";

interface CustomDeckBuilderProps {
  deck: CustomDeck | null;
  onCancel: () => void;
  onDelete: (deck: CustomDeck) => void;
  onSave: (deck: CustomDeck) => void;
}

export function CustomDeckBuilder({ deck, onCancel, onDelete, onSave }: CustomDeckBuilderProps) {
  const [name, setName] = useState(deck?.name ?? "");
  const [cardText, setCardText] = useState(() => deck?.cards.join("\n") ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cards = useMemo(() => parseDeckText(cardText), [cardText]);
  const canSave = name.trim().length > 0 && cards.length >= 3;

  useEffect(() => {
    let settleFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      settleFrame = window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, []);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("empty clipboard");
      setCardText(text);
      if (!name.trim()) setName(deckNameFromText(text) ?? "");
      setMessage("List pasted.");
    } catch {
      setMessage("Tap and hold inside the box to paste.");
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setCardText(text);
    if (!name.trim()) {
      setName(deckNameFromText(text) ?? file.name.replace(/\.(?:txt|text|csv)$/i, ""));
    }
    setMessage("List imported.");
  };

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <button type="button" onClick={onCancel} className="min-h-11 px-1 hover:text-white">
          ← decks
        </button>
        <span>{deck ? "edit deck" : "new deck"}</span>
      </header>

      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-10">
        <p className="mt-7 font-mono text-micro uppercase tracking-[0.2em] text-white/45">
          make it yours
        </p>
        <h1 className="mt-3 font-serif text-5xl font-semibold leading-none">Build a deck.</h1>
        <p className="mt-4 font-serif text-lg leading-relaxed text-white/60">
          Paste from Notes or Keep. One card per line—we clean up bullets and duplicates for you.
        </p>

        <div className="mt-8">
          <label htmlFor="deck-name" className="font-mono text-xs text-white/65">
            deck name
          </label>
          <input
            id="deck-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={50}
            placeholder="Family favourites"
            className="mt-2 min-h-14 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 font-serif text-lg text-white placeholder:text-white/25"
          />
        </div>

        <div className="mt-6">
          <div className="flex items-end justify-between gap-4">
            <label htmlFor="deck-cards" className="font-mono text-xs text-white/65">
              cards · {cards.length}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handlePaste()}
                className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/70"
              >
                paste list
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/70"
              >
                import file
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.text,.csv,text/plain,text/csv"
                onChange={(event) => void handleFile(event.target.files?.[0])}
                className="sr-only"
                aria-label="Import deck from a text file"
              />
            </div>
          </div>
          <textarea
            id="deck-cards"
            value={cardText}
            onChange={(event) => setCardText(event.target.value)}
            rows={11}
            placeholder={"Beyoncé\nThe Moon\nSunday roast"}
            aria-describedby="deck-help deck-message"
            className="mt-2 w-full resize-y rounded-3xl border border-white/15 bg-white/[0.06] p-4 font-serif text-lg leading-relaxed text-white placeholder:text-white/25"
          />
          <p id="deck-help" className="mt-2 font-mono text-micro leading-relaxed text-white/40">
            3–200 cards · blank lines and repeated cards are ignored
          </p>
          <p
            id="deck-message"
            aria-live="polite"
            className="mt-2 min-h-4 font-mono text-xs text-white/60"
          >
            {message}
          </p>
        </div>

        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(createCustomDeck(name, cards, deck?.id))}
          className="mt-5 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-35"
        >
          {canSave ? `save & play · ${cards.length} cards` : "add at least 3 cards"}
        </button>

        {deck ? (
          <button
            type="button"
            onClick={() => onDelete(deck)}
            className="mt-4 min-h-11 w-full font-mono text-xs text-white/45 hover:text-white/70"
          >
            delete this deck
          </button>
        ) : null}
      </main>
    </div>
  );
}
