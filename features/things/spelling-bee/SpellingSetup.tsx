import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SpellingDeck } from "./decks";
import type { AssistantBackend, AssistantStatus, BrowserSpeechAvailability } from "./useLocalSpellingAssistant";

export function SpellingSetup({
  decks,
  selectedDeckId,
  customDeckIds,
  timerSeconds,
  autoSpeak,
  soundEnabled,
  remoteControls,
  assistantStatus,
  assistantProgress,
  assistantMessage,
  assistantBackend,
  browserSpeechAvailability,
  downloadEstimate,
  onSelectDeck,
  onTimerChange,
  onToggleAutoSpeak,
  onToggleSound,
  onCreateDeck,
  onEditDeck,
  onStart,
  onEnableAssistant,
  onDisableAssistant,
}: {
  decks: SpellingDeck[];
  selectedDeckId: string;
  customDeckIds: Set<string>;
  timerSeconds: number;
  autoSpeak: boolean;
  soundEnabled: boolean;
  remoteControls: ReactNode;
  assistantStatus: AssistantStatus;
  assistantProgress: number;
  assistantMessage: string | null;
  assistantBackend: AssistantBackend;
  browserSpeechAvailability: BrowserSpeechAvailability;
  downloadEstimate: string;
  onSelectDeck: (id: string) => void;
  onTimerChange: (seconds: number) => void;
  onToggleAutoSpeak: () => void;
  onToggleSound: () => void;
  onCreateDeck: () => void;
  onEditDeck: (id: string) => void;
  onStart: () => void;
  onEnableAssistant: () => void;
  onDisableAssistant: () => void;
}) {
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">← things</Link>
        <button type="button" onClick={onToggleSound} className="min-h-11 rounded-full px-2">sound {soundEnabled ? "on" : "off"}</button>
      </header>
      <main id="main" className="flex-1 px-5 pb-10">
        <section className="mx-auto max-w-lg pt-7">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">a pocket spelling bee</p>
          <h1 className="mt-3 font-serif text-6xl font-semibold leading-none tracking-tight">Spelling Bee.</h1>
          <p className="mt-5 max-w-md font-serif text-lg leading-relaxed text-white/65">Hear the word, spell it aloud, then tilt or let a judge decide.</p>
        </section>
        <section className="mx-auto mt-10 max-w-lg" aria-labelledby="spelling-decks">
          <div className="flex items-center justify-between gap-4"><h2 id="spelling-decks" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">choose words</h2><button type="button" onClick={onCreateDeck} className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs">+ make a deck</button></div>
          <div className="mt-3 grid gap-3">
            {decks.map((deck) => {
              const selected = deck.id === selectedDeckId;
              return <div key={deck.id} className={`grid grid-cols-[1fr_auto] items-center gap-2 rounded-3xl border p-2 ${selected ? "border-white/60 bg-white/12" : "border-white/12 bg-white/[0.04]"}`}>
                <button type="button" onClick={() => onSelectDeck(deck.id)} aria-pressed={selected} className="grid min-h-20 grid-cols-[2.75rem_1fr_auto] items-center gap-3 p-2 text-left">
                  <span aria-hidden="true" className="font-serif text-2xl text-white/60">{deck.symbol}</span><span><span className="block font-serif text-xl font-semibold">{deck.name}</span><span className="mt-1 block text-xs leading-relaxed text-white/50">{deck.description}</span></span><span className="font-mono text-xs text-white/40">{deck.words.length}</span>
                </button>
                {customDeckIds.has(deck.id) ? <button type="button" onClick={() => onEditDeck(deck.id)} className="min-h-11 rounded-full px-3 font-mono text-xs text-white/55">edit</button> : null}
              </div>;
            })}
          </div>
        </section>
        <section className="mx-auto mt-8 max-w-lg rounded-3xl border border-white/12 p-5" aria-labelledby="bee-settings">
          <h2 id="bee-settings" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">round settings</h2>
          <label htmlFor="word-timer" className="mt-5 flex items-center justify-between gap-4 font-mono text-xs text-white/65"><span>time per word</span><select id="word-timer" value={timerSeconds} onChange={(event) => onTimerChange(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4 text-white"><option value={0}>off</option>{[10, 15, 20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-4 font-mono text-xs text-white/65"><span>read each word aloud</span><input type="checkbox" checked={autoSpeak} onChange={onToggleAutoSpeak} className="h-5 w-5 accent-[var(--things-amber)]" /></label>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs text-white/70">live spelling assistance</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-white/45">We try verified on-device browser speech first. If unavailable, private Whisper is ~50 MB and takes {downloadEstimate}. The judge still confirms.</p></div>{assistantStatus === "checking" ? <span className="shrink-0 px-2 py-3 font-mono text-micro text-white/40">checking…</span> : assistantBackend || assistantStatus === "ready" || assistantStatus === "listening" ? <button type="button" onClick={onDisableAssistant} className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs text-white/55">turn off</button> : <button type="button" onClick={onEnableAssistant} className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs">{browserSpeechAvailability === "available" ? "use device speech" : browserSpeechAvailability === "downloadable" || browserSpeechAvailability === "downloading" ? "install device pack" : "download ~50 MB"}</button>}</div>
            {assistantStatus === "loading" ? <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--things-amber)] transition-[width]" style={{ width: `${assistantProgress}%` }} /></div><p className="mt-2 font-mono text-micro text-white/45">downloading · {assistantProgress}%</p></div> : null}
            <p aria-live="polite" className="mt-2 min-h-4 font-mono text-micro leading-relaxed text-white/45">{assistantMessage}</p>
          </div>
        </section>
        <div className="mx-auto max-w-lg">{remoteControls}</div>
        <div className="mx-auto mt-8 max-w-lg"><button type="button" onClick={onStart} className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black">start spelling</button><p className="mt-3 text-center font-mono text-micro text-white/40">tilt down = correct · tilt up = incorrect / skip</p></div>
      </main>
    </div>
  );
}
