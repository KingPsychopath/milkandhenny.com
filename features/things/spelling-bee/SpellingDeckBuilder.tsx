import { useMemo, useState } from "react";
import {
  createCustomSpellingDeck,
  formatSpellingWords,
  parseSpellingWords,
  type CustomSpellingDeck,
} from "./customDecks";
import { speakWord } from "./localSpeech";

export function SpellingDeckBuilder({
  deck,
  onCancel,
  onDelete,
  onSave,
}: {
  deck: CustomSpellingDeck | null;
  onCancel: () => void;
  onDelete: (deck: CustomSpellingDeck) => void;
  onSave: (deck: CustomSpellingDeck) => void;
}) {
  const [name, setName] = useState(deck?.name ?? "");
  const [text, setText] = useState(deck ? formatSpellingWords(deck.words) : "");
  const [message, setMessage] = useState<string | null>(null);
  const words = useMemo(() => parseSpellingWords(text), [text]);
  const canSave = name.trim().length > 0 && words.length >= 3;

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <button type="button" onClick={onCancel} className="min-h-11">← decks</button>
        <span>{deck ? "edit word list" : "new word list"}</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-5 pb-10">
        <p className="mt-7 font-mono text-micro uppercase tracking-[0.2em] text-white/45">your dictionary</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold leading-none">Build a bee.</h1>
        <p className="mt-4 font-serif text-lg leading-relaxed text-white/60">
          One word per line. Add optional part of speech, definition and pronunciation with vertical bars.
        </p>
        <label htmlFor="spelling-deck-name" className="mt-8 block font-mono text-xs text-white/65">deck name</label>
        <input id="spelling-deck-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} className="mt-2 min-h-14 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 font-serif text-lg" placeholder="Family spelling night" />
        <label htmlFor="spelling-words" className="mt-6 block font-mono text-xs text-white/65">words · {words.length}</label>
        <textarea
          id="spelling-words"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={13}
          aria-describedby="spelling-word-format spelling-builder-message"
          placeholder={"quay | noun | a platform beside water | key\nrhythm | noun | a repeated pattern\nbeautiful | adjective | pleasing to the senses"}
          className="mt-2 w-full resize-y rounded-3xl border border-white/15 bg-white/[0.06] p-4 font-serif text-base leading-relaxed"
        />
        <p id="spelling-word-format" className="mt-2 font-mono text-micro leading-relaxed text-white/40">word | part of speech | short definition | pronounce as</p>
        {words[0] ? (
          <button type="button" onClick={() => void speakWord(words[0]).then((ok) => setMessage(ok ? `Previewed “${words[0].word}”.` : "No local English voice is installed."))} className="mt-3 min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/65">preview first word</button>
        ) : null}
        <p id="spelling-builder-message" aria-live="polite" className="mt-2 min-h-4 font-mono text-xs text-white/55">{message}</p>
        <button type="button" disabled={!canSave} onClick={() => onSave(createCustomSpellingDeck(name, words, deck?.id))} className="mt-5 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-35">
          {canSave ? `save & play · ${words.length} words` : "add at least 3 words"}
        </button>
        {deck ? <button type="button" onClick={() => onDelete(deck)} className="mt-4 min-h-11 w-full font-mono text-xs text-white/45">delete this deck</button> : null}
      </main>
    </div>
  );
}
