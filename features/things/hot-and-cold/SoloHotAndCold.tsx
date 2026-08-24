import { useEffect, useMemo, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { GiveUpControl } from "../shared/GiveUpControl";
import { HeatLedger } from "./HeatLedger";
import { GuessComposer } from "./GuessComposer";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { revealDailyHotAndColdFn, scoreDailyHotAndColdGuessFn } from "./hot-and-cold.functions";
import type { SoloHotAndColdGuess } from "./types";

interface DailyState {
  puzzle: number;
  guesses: SoloHotAndColdGuess[];
  target: string | null;
  gaveUp: boolean;
}
export function SoloHotAndCold({ puzzle, onExit }: { puzzle: number; onExit: () => void }) {
  const haptics = useWebHaptics();
  const [state, setState] = useState<DailyState>({
    puzzle,
    guesses: [],
    target: null,
    gaveUp: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [newest, setNewest] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(hotAndColdBrowserKeys.daily(puzzle));
      if (stored) setState(JSON.parse(stored) as DailyState);
    } catch {
      /* play without recovery */
    }
  }, [puzzle]);
  useEffect(() => {
    try {
      localStorage.setItem(hotAndColdBrowserKeys.daily(puzzle), JSON.stringify(state));
    } catch {
      /* play without recovery */
    }
  }, [puzzle, state]);
  const ledger = useMemo(
    () =>
      state.guesses.map((guess) => ({
        ...guess,
        id: `${guess.sequence}:${guess.word}`,
        mine: true,
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
    } catch {
      setMessage("the scorer is warming up — try again");
      return false;
    }
  };
  const giveUp = async () => {
    const result = await revealDailyHotAndColdFn();
    setState((current) => ({ ...current, target: result.target, gaveUp: true }));
    return true;
  };
  const done = Boolean(state.target);
  const hottest = ledger.reduce<(typeof ledger)[number] | null>(
    (best, guess) => (!best || guess.rank < best.rank ? guess : best),
    null,
  );
  return (
    <div className="hot-and-cold min-h-svh">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 pt-3 font-mono text-xs theme-muted">
        <button type="button" className="min-h-11" onClick={onExit}>
          ← hot and cold
        </button>
        <span>daily #{puzzle}</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-5">
        <div className="heat-source">
          <div className="heat-source-flame" aria-hidden="true">
            {done ? "✦" : "♨"}
          </div>
          <p>
            {done
              ? state.gaveUp
                ? "revealed"
                : `found in ${state.guesses.length}`
              : hottest
                ? `hottest · #${hottest.rank.toLocaleString()}`
                : "0 · the secret word"}
          </p>
        </div>
        <HeatLedger guesses={ledger} newestId={newest} target={state.target} />
        {done ? (
          <section className="pb-24 text-center">
            <p className="font-serif text-xl theme-muted">
              {state.gaveUp ? "Tomorrow is another word." : "You found the heat."}
            </p>
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
        <>
          <GuessComposer message={message} onGuess={guess} />
          <GiveUpControl
            tone="dark"
            title="Reveal today’s word?"
            description="The word will appear at the top of your ledger. You cannot continue this daily hunt."
            onGiveUp={giveUp}
            className="fixed bottom-24 left-1/2 z-30 min-h-11 -translate-x-1/2 font-mono text-micro theme-faint"
          />
        </>
      ) : null}
    </div>
  );
}
