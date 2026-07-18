import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { GameDeck } from "./decks";
import { OrientationControls } from "../shared/OrientationControls";
import {
  GameLaunch,
  GameLaunchButton,
  GameLaunchChoices,
  GameLaunchMeta,
} from "../shared/GameLaunch";

interface HeadsUpSetupProps {
  decks: GameDeck[];
  fullscreenActive: boolean;
  fullscreenInstallFallback: boolean;
  fullscreenMessage: string | null;
  fullscreenStandalone: boolean;
  fullscreenSupported: boolean;
  locked: boolean;
  motionUnavailable: boolean;
  selectedDeckId: string;
  soundEnabled: boolean;
  customDeckIds: Set<string>;
  shareMessage: string | null;
  remoteControls: ReactNode;
  onCreateDeck: () => void;
  onEditDeck: (id: string) => void;
  onFullscreen: () => void;
  onSelectDeck: (id: string) => void;
  onShareDeck: (id: string) => void;
  onStart: () => void;
  onToggleLock: () => void;
  onToggleSound: () => void;
}

export function HeadsUpSetup({
  decks,
  fullscreenActive,
  fullscreenInstallFallback,
  fullscreenMessage,
  fullscreenStandalone,
  fullscreenSupported,
  locked,
  motionUnavailable,
  selectedDeckId,
  soundEnabled,
  customDeckIds,
  shareMessage,
  remoteControls,
  onCreateDeck,
  onEditDeck,
  onFullscreen,
  onSelectDeck,
  onShareDeck,
  onStart,
  onToggleLock,
  onToggleSound,
}: HeadsUpSetupProps) {
  const selectedIsCustom = customDeckIds.has(selectedDeckId);
  const selectedDeck = decks.find(({ id }) => id === selectedDeckId) ?? decks[0];
  const [panel, setPanel] = useState<"decks" | "options" | "judge" | null>(null);
  const togglePanel = (next: NonNullable<typeof panel>) => {
    setPanel((current) => (current === next ? null : next));
  };

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="min-h-11 inline-flex items-center hover:text-white">
          ← things
        </Link>
        <button
          type="button"
          onClick={onToggleSound}
          className="min-h-11 rounded-full px-2 hover:text-white"
          aria-pressed={soundEnabled}
        >
          sound {soundEnabled ? "on" : "off"}
        </button>
      </header>

      <main id="main" className="flex-1 px-5 pb-10">
        <GameLaunch
          tone="night"
          eyebrow="a guessing game"
          title="Forehead."
          description="Guess the card from your friends' clues. Tilt down for correct, up to pass."
        >
          <GameLaunchButton accent="amber" onClick={onStart}>
            start
          </GameLaunchButton>
          <GameLaunchMeta tone="dark">
            {selectedDeck?.name ?? "All sorts"} · 60 seconds
          </GameLaunchMeta>
          <GameLaunchChoices tone="dark">
            <button
              type="button"
              onClick={() => togglePanel("decks")}
              aria-pressed={panel === "decks"}
              className="min-h-11"
            >
              change deck
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
          </GameLaunchChoices>
        </GameLaunch>

        {panel === "decks" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-labelledby="choose-deck"
          >
            <div className="flex items-center justify-between gap-4">
              <h2
                id="choose-deck"
                className="font-mono text-micro uppercase tracking-[0.18em] text-white/45"
              >
                choose a deck
              </h2>
              <button
                type="button"
                onClick={onCreateDeck}
                className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/70"
              >
                + make a deck
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              {decks.map((deck) => {
                const selected = deck.id === selectedDeckId;
                return (
                  <button
                    type="button"
                    key={deck.id}
                    onClick={() => onSelectDeck(deck.id)}
                    aria-pressed={selected}
                    className={`grid min-h-24 min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-3xl border p-4 text-left transition-[transform,border-color,background-color] ${
                      selected ? "border-white/60 bg-white/12" : "border-white/12 bg-white/[0.04]"
                    }`}
                  >
                    <span className="font-serif text-3xl text-white/65" aria-hidden="true">
                      {deck.symbol}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-serif text-xl font-semibold">
                        {deck.name}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-white/50">
                        {deck.description}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-white/45">{deck.cards.length}</span>
                  </button>
                );
              })}
            </div>

            {selectedIsCustom ? (
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onEditDeck(selectedDeckId)}
                  className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/65"
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => onShareDeck(selectedDeckId)}
                  className="min-h-11 rounded-full border border-white/15 px-4 font-mono text-xs text-white/65"
                >
                  share / export
                </button>
              </div>
            ) : null}
            <p
              aria-live="polite"
              className="mt-2 min-h-4 text-right font-mono text-xs text-white/55"
            >
              {shareMessage}
            </p>
          </section>
        ) : null}

        {panel === "options" ? (
          <section
            className="mx-auto mt-10 max-w-lg border-t border-white/12 pt-7"
            aria-labelledby="forehead-options"
          >
            <h2 id="forehead-options" className="font-serif text-3xl font-semibold">
              Options
            </h2>
            <OrientationControls
              fullscreenActive={fullscreenActive}
              fullscreenInstallFallback={fullscreenInstallFallback}
              fullscreenMessage={fullscreenMessage}
              fullscreenStandalone={fullscreenStandalone}
              fullscreenSupported={fullscreenSupported}
              locked={locked}
              motionUnavailable={motionUnavailable}
              onFullscreen={onFullscreen}
              onToggle={onToggleLock}
            />
          </section>
        ) : null}

        {panel === "judge" ? <div className="mx-auto max-w-lg">{remoteControls}</div> : null}
      </main>
    </div>
  );
}
