import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { SpellingDeck } from "../spelling/decks";
import { spellingRoundOptions } from "../spelling/decks";
import { SpellingDeckPicker } from "../spelling/SpellingDeckPicker";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";
import type {
  AssistantBackend,
  AssistantStatus,
  BrowserSpeechAvailability,
} from "./useLocalSpellingAssistant";

interface SpellingSetupProps {
  assistantBackend: AssistantBackend;
  assistantMessage: string | null;
  assistantProgress: number;
  assistantStatus: AssistantStatus;
  autoSpeak: boolean;
  browserSpeechAvailability: BrowserSpeechAvailability;
  customDeckIds: Set<string>;
  decks: SpellingDeck[];
  downloadEstimate: string;
  onCreateDeck: () => void;
  onDisableAssistant: () => void;
  onEditDeck: (id: string) => void;
  onEnableAssistant: () => void;
  onRoundTotalChange: (count: number) => void;
  onSelectDeck: (id: string) => void;
  onStart: () => void;
  onTimerChange: (seconds: number) => void;
  onToggleAutoSpeak: () => void;
  onToggleSound: () => void;
  remoteControls: ReactNode;
  roundTotal: number;
  selectedDeckId: string;
  soundEnabled: boolean;
  timerSeconds: number;
}

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
}: SpellingSetupProps) {
  const selectedDeck = decks.find(({ id }) => id === selectedDeckId) ?? decks[0];
  const wordCount = selectedDeck?.words.length ?? 0;
  const [panel, setPanel] = useState<"words" | "options" | "judge" | null>(null);
  const togglePanel = (next: NonNullable<typeof panel>) => {
    setPanel((current) => (current === next ? null : next));
  };

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">
          ← things
        </Link>
        <button type="button" onClick={onToggleSound} aria-pressed={soundEnabled} className="min-h-11 rounded-full px-2">
          sound {soundEnabled ? "on" : "off"}
        </button>
      </header>

      <main id="main" className="flex-1 px-5 pb-10">
        <GameLaunch
          tone="night"
          eyebrow="spelling bee · say it aloud"
          title="Spelling Bee."
          description="Hear the word. Spell it aloud. Tilt down for correct, up to skip."
        >
          <GameLaunchButton accent="amber" onClick={onStart}>
            start
          </GameLaunchButton>
          <GameLaunchMeta tone="dark">
            {selectedDeck?.name ?? "Warm-up words"} · {Math.min(roundTotal, wordCount)} words ·{" "}
            {timerSeconds ? `${timerSeconds} seconds` : "no timer"}
          </GameLaunchMeta>
          <GameLaunchChoices tone="dark">
            <button
              type="button"
              onClick={() => togglePanel("words")}
              aria-pressed={panel === "words"}
              className="min-h-11"
            >
              change words
            </button>
            <button
              type="button"
              onClick={() => togglePanel("options")}
              aria-pressed={panel === "options"}
              className="min-h-11"
            >
              options
            </button>
            <button
              type="button"
              onClick={() => togglePanel("judge")}
              aria-pressed={panel === "judge"}
              className="min-h-11"
            >
              remote judge
            </button>
            <Link to="/things/spelling-party" className="inline-flex min-h-11 items-center">
              type together →
            </Link>
          </GameLaunchChoices>
        </GameLaunch>

        {panel === "words" ? (
          <div className="border-t border-white/12">
            <SpellingDeckPicker
              decks={decks.map((deck) => ({
                id: deck.id,
                name: deck.name,
                description: deck.description,
                symbol: deck.symbol,
                wordCount: deck.words.length,
              }))}
              selectedDeckId={selectedDeckId}
              customDeckIds={customDeckIds}
              onSelectDeck={onSelectDeck}
              onCreateDeck={onCreateDeck}
              onEditDeck={onEditDeck}
            />
          </div>
        ) : null}

        {panel === "options" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-labelledby="bee-settings"
          >
            <h2 id="bee-settings" className="font-serif text-3xl font-semibold">
              Options
            </h2>
            <label
              htmlFor="round-words"
              className="mt-5 flex items-center justify-between gap-4 font-mono text-xs text-white/65"
            >
              <span>words</span>
              <select
                id="round-words"
                value={Math.min(roundTotal, wordCount)}
                onChange={(event) => onRoundTotalChange(Number(event.target.value))}
                className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4 text-white"
              >
                {spellingRoundOptions(wordCount).map((value) => (
                  <option key={value} value={value}>
                    {value === wordCount ? `all ${value}` : value}
                  </option>
                ))}
              </select>
            </label>
            <label
              htmlFor="word-timer"
              className="mt-3 flex items-center justify-between gap-4 font-mono text-xs text-white/65"
            >
              <span>time per word</span>
              <select
                id="word-timer"
                value={timerSeconds}
                onChange={(event) => onTimerChange(Number(event.target.value))}
                className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-4 text-white"
              >
                <option value={0}>off</option>
                {[10, 15, 20, 30, 45, 60].map((value) => (
                  <option key={value} value={value}>
                    {value} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-4 font-mono text-xs text-white/65">
              <span>read words aloud</span>
              <input
                type="checkbox"
                checked={autoSpeak}
                onChange={onToggleAutoSpeak}
                className="h-5 w-5 accent-[var(--things-amber)]"
              />
            </label>

            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs text-white/70">follow the spelling</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/45">
                    Highlights letters as they’re spoken. The judge still decides.
                  </p>
                  {browserSpeechAvailability === "downloadable" ||
                  browserSpeechAvailability === "downloading" ? (
                    <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/45">
                      Needs a one-time speech setup.
                    </p>
                  ) : browserSpeechAvailability === "unavailable" ? (
                    <p className="mt-2 max-w-xs text-xs leading-relaxed text-white/45">
                      First setup is about 50 MB and takes {downloadEstimate}.
                    </p>
                  ) : null}
                </div>
                {assistantStatus === "checking" ? (
                  <span className="shrink-0 px-2 py-3 font-mono text-micro text-white/40">
                    checking…
                  </span>
                ) : assistantBackend ||
                  assistantStatus === "ready" ||
                  assistantStatus === "listening" ? (
                  <button
                    type="button"
                    onClick={onDisableAssistant}
                    className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs text-white/55"
                  >
                    turn off
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onEnableAssistant}
                    className="min-h-11 shrink-0 rounded-full border border-white/15 px-4 font-mono text-xs"
                  >
                    {browserSpeechAvailability === "available" ? "turn on" : "set up once"}
                  </button>
                )}
              </div>
              {assistantStatus === "loading" ? (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-[var(--things-amber)] transition-[width]"
                      style={{ width: `${assistantProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-micro text-white/45">
                    setting up · {assistantProgress}%
                  </p>
                </div>
              ) : null}
              <p
                aria-live="polite"
                className="mt-2 min-h-4 font-mono text-micro leading-relaxed text-white/45"
              >
                {assistantMessage}
              </p>
            </div>
          </section>
        ) : null}

        {panel === "judge" ? <div className="mx-auto max-w-lg">{remoteControls}</div> : null}
      </main>
    </div>
  );
}
