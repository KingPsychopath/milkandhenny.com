import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SpellingDeck } from "./decks";
import { spellingRoundOptions } from "./decks";
import { SpellingSetupIntro } from "./SpellingSetupIntro";
import { SpellingDeckPicker } from "./SpellingDeckPicker";
import type { AssistantBackend, AssistantStatus, BrowserSpeechAvailability } from "./useLocalSpellingAssistant";

export function SpellingSetup({
  decks,
  selectedDeckId,
  customDeckIds,
  timerSeconds,
  roundTotal,
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
  onRoundTotalChange,
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
  roundTotal: number;
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
  onRoundTotalChange: (count: number) => void;
  onToggleAutoSpeak: () => void;
  onToggleSound: () => void;
  onCreateDeck: () => void;
  onEditDeck: (id: string) => void;
  onStart: () => void;
  onEnableAssistant: () => void;
  onDisableAssistant: () => void;
}) {
  const selectedDeck = decks.find(({ id }) => id === selectedDeckId) ?? decks[0];
  const wordCount = selectedDeck?.words.length ?? 0;
  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">← things</Link>
        <button type="button" onClick={onToggleSound} className="min-h-11 rounded-full px-2">sound {soundEnabled ? "on" : "off"}</button>
      </header>
      <main id="main" className="flex-1 px-5 pb-10">
        <SpellingSetupIntro mode="aloud" />
        <SpellingDeckPicker decks={decks.map((deck) => ({ id: deck.id, name: deck.name, description: deck.description, symbol: deck.symbol, wordCount: deck.words.length }))} selectedDeckId={selectedDeckId} customDeckIds={customDeckIds} onSelectDeck={onSelectDeck} onCreateDeck={onCreateDeck} onEditDeck={onEditDeck} />
        <section className="mx-auto mt-8 max-w-lg rounded-3xl border border-white/12 p-5" aria-labelledby="bee-settings">
          <h2 id="bee-settings" className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">round settings</h2>
          <label htmlFor="round-words" className="mt-5 flex items-center justify-between gap-4 font-mono text-xs text-white/65"><span>words this game</span><select id="round-words" value={Math.min(roundTotal, wordCount)} onChange={(event) => onRoundTotalChange(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4 text-white">{spellingRoundOptions(wordCount).map((value) => <option key={value} value={value}>{value === wordCount ? `all ${value}` : value}</option>)}</select></label>
          <label htmlFor="word-timer" className="mt-3 flex items-center justify-between gap-4 font-mono text-xs text-white/65"><span>time per word</span><select id="word-timer" value={timerSeconds} onChange={(event) => onTimerChange(Number(event.target.value))} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4 text-white"><option value={0}>off</option>{[10, 15, 20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-4 font-mono text-xs text-white/65"><span>read each word aloud</span><input type="checkbox" checked={autoSpeak} onChange={onToggleAutoSpeak} className="h-5 w-5 accent-[var(--things-amber)]" /></label>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs text-white/70">follow the spelling</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-white/45">Optional. Highlights each letter as it is spoken and pauses when the word looks complete. The judge still makes the final call.</p><p className="mt-2 max-w-xs text-xs leading-relaxed text-white/45">Reduces steady background noise when this device supports it. A quieter room still works best.</p>{browserSpeechAvailability === "downloadable" || browserSpeechAvailability === "downloading" ? <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/45">This device needs a one-time speech setup before it can listen.</p> : browserSpeechAvailability === "unavailable" ? <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/45">First use needs a one-time 50 MB setup and takes {downloadEstimate}.</p> : null}</div>{assistantStatus === "checking" ? <span className="shrink-0 px-2 py-3 font-mono text-micro text-white/40">checking…</span> : assistantBackend || assistantStatus === "ready" || assistantStatus === "listening" ? <button type="button" onClick={onDisableAssistant} className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs text-white/55">turn off</button> : <button type="button" onClick={onEnableAssistant} className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs">{browserSpeechAvailability === "available" ? "turn on" : "set up once"}</button>}</div>
            {assistantStatus === "loading" ? <div className="mt-3"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--things-amber)] transition-[width]" style={{ width: `${assistantProgress}%` }} /></div><p className="mt-2 font-mono text-micro text-white/45">setting up · {assistantProgress}%</p></div> : null}
            <p aria-live="polite" className="mt-2 min-h-4 font-mono text-micro leading-relaxed text-white/45">{assistantMessage}</p>
          </div>
        </section>
        <div className="mx-auto max-w-lg">{remoteControls}</div>
        <div className="mx-auto mt-8 max-w-lg"><button type="button" onClick={onStart} className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black">start spelling</button><p className="mt-3 text-center font-mono text-micro text-white/40">tilt down = correct · tilt up = skip</p></div>
      </main>
    </div>
  );
}
