import { useEffect, useMemo, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { GiveUpControl } from "../shared/GiveUpControl";
import { HeatLedger } from "./HeatLedger";
import { GuessComposer } from "./GuessComposer";
import { HotAndColdResultShare } from "./HotAndColdResultShare";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import {
  getDailyHotAndColdHintFn,
  revealDailyHotAndColdFn,
  scoreDailyHotAndColdGuessFn,
} from "./hot-and-cold.functions";
import type { SoloHotAndColdGuess } from "./types";

interface DailyState {
  puzzle: number;
  guesses: SoloHotAndColdGuess[];
  target: string | null;
  gaveUp: boolean;
  hintsUsed: number;
}
export function SoloHotAndCold({ puzzle, onExit }: { puzzle: number; onExit: () => void }) {
  const haptics = useWebHaptics();
  const [state, setState] = useState<DailyState>({
    puzzle,
    guesses: [],
    target: null,
    gaveUp: false,
    hintsUsed: 0,
  });
  const [recovered, setRecovered] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newest, setNewest] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(hotAndColdBrowserKeys.daily(puzzle));
      if (stored) {
        const saved = JSON.parse(stored) as Partial<DailyState>;
        setState((current) => ({
          ...current,
          ...saved,
          guesses: saved.guesses ?? [],
          hintsUsed: saved.hintsUsed ?? saved.guesses?.filter(({ hint }) => hint).length ?? 0,
        }));
      }
    } catch {
      /* play without recovery */
    } finally {
      setRecovered(true);
    }
  }, [puzzle]);
  useEffect(() => {
    if (!recovered) return;
    try {
      localStorage.setItem(hotAndColdBrowserKeys.daily(puzzle), JSON.stringify(state));
    } catch {
      /* play without recovery */
    }
  }, [puzzle, recovered, state]);
  const ledger = useMemo(
    () =>
      state.guesses.map((guess) => ({
        ...guess,
        id: `${guess.sequence}:${guess.word}`,
        mine: !guess.hint,
        playerName: guess.hint ? "hint" : undefined,
      })),
    [state.guesses],
  );
  const guess = async (raw: string) => {
    const word = raw.toLowerCase();
    const existing = state.guesses.find((item) => item.word === word);
    if (existing) {
      setMessage(`already #${existing.rank.toLocaleString()}`);
      return false;
    }
    try {
      const result = await scoreDailyHotAndColdGuessFn({ data: { word } });
      if (!result.ok) {
        setMessage("not in our word list");
        return false;
      }
      const canonicalExisting = state.guesses.find((item) => item.word === result.word);
      if (canonicalExisting) {
        setMessage(`already #${canonicalExisting.rank.toLocaleString()}`);
        return false;
      }
      const next = {
        word: result.word,
        rank: result.rank,
        band: result.band,
        sequence: state.guesses.length + 1,
        createdAt: Date.now(),
      };
      setState((current) => ({
        ...current,
        guesses: [...current.guesses, next],
        target: result.rank === 0 ? result.word : current.target,
      }));
      setNewest(`${next.sequence}:${next.word}`);
      setMessage(result.rank === 0 ? "found it" : result.band);
      void haptics.trigger(
        result.rank === 0 ? "success" : result.rank < 500 ? "warning" : "selection",
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message.toLowerCase() : "";
      setMessage(
        reason.includes("dictionary")
          ? "not in our word list"
          : "the scorer is warming up — try again",
      );
      return false;
    }
  };
  const requestHint = async () => {
    try {
      const result = await getDailyHotAndColdHintFn({
        data: { hintIndex: state.hintsUsed, usedWords: state.guesses.map(({ word }) => word) },
      });
      const next: SoloHotAndColdGuess = {
        word: result.word,
        rank: result.rank,
        band: result.band,
        sequence: state.guesses.length + 1,
        createdAt: Date.now(),
        hint: true,
      };
      setState((current) => ({
        ...current,
        guesses: [...current.guesses, next],
        hintsUsed: current.hintsUsed + 1,
      }));
      setNewest(`${next.sequence}:${next.word}`);
      setMessage(`hint · #${next.rank.toLocaleString()}`);
      void haptics.trigger("selection");
    } catch {
      setMessage("no more hints today");
    }
  };
  const giveUp = async () => {
    const result = await revealDailyHotAndColdFn();
    setState((current) => ({ ...current, target: result.target, gaveUp: true }));
    return true;
  };
  const done = Boolean(state.target);
  const playerGuesses = state.guesses.filter(({ hint }) => !hint);
  const hottest = ledger.reduce<(typeof ledger)[number] | null>(
    (best, guess) => (!best || guess.rank < best.rank ? guess : best),
    null,
  );
  return (
    <div className="hot-and-cold min-h-svh">
      <header className="mx-auto grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center px-5 pt-3 font-mono text-xs theme-muted">
        <button type="button" className="min-h-11" onClick={onExit}>
          ← hot and cold
        </button>
        <span>daily #{puzzle}</span>
        <button
          type="button"
          className="grid size-11 place-items-center justify-self-end rounded-full font-mono text-xs theme-faint"
          aria-label="How heat works"
          aria-expanded={showHow}
          aria-controls="how-heat-works"
          onClick={() => setShowHow((open) => !open)}
        >
          ?
        </button>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-5">
        <div className="heat-source">
          <div className="heat-source-flame" data-found={done || undefined} aria-hidden="true">
            {done ? "✦" : null}
          </div>
          <p>
            {done
              ? state.gaveUp
                ? "revealed"
                : `found in ${playerGuesses.length}`
              : hottest
                ? `hottest · #${hottest.rank.toLocaleString()}`
                : "0 · the secret word"}
          </p>
        </div>
        {showHow ? (
          <section id="how-heat-works" className="heat-explainer" aria-label="How heat works">
            <h2>how does a word get hot?</h2>
            <p>
              Hot words live near the secret in language. They can mean something similar, belong to
              the same group, form a familiar pair, or even be opposites. Lower ranks are hotter;
              zero is the exact word.
            </p>
            <p>
              We rank a fixed list of common dictionary words before the game. Names are not
              accepted, and normal forms such as “dogs” resolve to “dog”.
            </p>
          </section>
        ) : null}
        <HeatLedger guesses={ledger} newestId={newest} target={state.target} />
        {done ? (
          <section className="pb-24 text-center">
            <p className="font-serif text-xl theme-muted">
              {state.gaveUp ? "Tomorrow is another word." : "You found the heat."}
            </p>
            <HotAndColdResultShare
              label={`daily #${puzzle}`}
              guesses={playerGuesses}
              outcome={state.gaveUp ? "revealed" : "found"}
              hintsUsed={state.hintsUsed}
            />
            <button
              type="button"
              className="mt-5 min-h-11 font-mono text-xs underline underline-offset-4"
              onClick={onExit}
            >
              back to hot and cold
            </button>
          </section>
        ) : null}
      </main>
      {!done ? (
        <GuessComposer
          message={message}
          onGuess={guess}
          actions={
            <>
              <button
                type="button"
                disabled={state.hintsUsed >= 3}
                onClick={() => void requestHint()}
              >
                {state.hintsUsed >= 3 ? "hints used" : "hint"}
              </button>
              <GiveUpControl
                tone="dark"
                title="Reveal today’s word?"
                description="The word will appear at the top of your ledger. You cannot continue this daily hunt."
                onGiveUp={giveUp}
              />
            </>
          }
        />
      ) : null}
    </div>
  );
}
