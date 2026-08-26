import { useEffect, useMemo, useState } from "react";
import { useWebHaptics } from "web-haptics/react";
import { GiveUpControl } from "../shared/GiveUpControl";
import { HeatGauge } from "./HeatGauge";
import { HeatLedger } from "./HeatLedger";
import { GuessComposer } from "./GuessComposer";
import { HotAndColdResultShare, HotAndColdShareDock } from "./HotAndColdResultShare";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { heatStreaks } from "./hot-and-cold-rules";
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
      setMessage(`already guessed · #${existing.rank.toLocaleString()}`);
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
        setMessage(`already guessed · #${canonicalExisting.rank.toLocaleString()}`);
        return false;
      }
      const next = {
        word: result.word,
        rank: result.rank,
        band: result.band,
        sequence: state.guesses.length + 1,
        createdAt: Date.now(),
      };
      const nextStreak = heatStreaks([...state.guesses, next]).current;
      setState((current) => ({
        ...current,
        guesses: [...current.guesses, next],
        target: result.rank === 0 ? result.word : current.target,
      }));
      setNewest(`${next.sequence}:${next.word}`);
      setMessage(
        result.rank === 0
          ? "found it"
          : nextStreak >= 3
            ? `hot streak · ${nextStreak}`
            : result.band,
      );
      void haptics.trigger(
        result.rank === 0 ? "success" : result.rank < 500 ? "warning" : "selection",
      );
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message.toLowerCase() : "";
      setMessage(
        reason.includes("dictionary") ? "not in our word list" : "couldn’t score that — try again",
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
      setMessage("couldn’t get a hint — try again");
    }
  };
  const giveUp = async () => {
    const result = await revealDailyHotAndColdFn();
    setState((current) => ({ ...current, target: result.target, gaveUp: true }));
    return true;
  };
  const done = Boolean(state.target);
  const playerGuesses = state.guesses.filter(({ hint }) => !hint);
  const streak = heatStreaks(state.guesses);
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
          className="min-h-11 justify-self-end font-mono text-micro underline decoration-transparent underline-offset-4 transition-opacity hover:opacity-60 hover:decoration-current"
          aria-expanded={showHow}
          aria-controls="how-heat-works"
          onClick={() => setShowHow((open) => !open)}
        >
          {showHow ? "close guide" : "how to play"}
        </button>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-5">
        <div className="heat-source">
          <HeatGauge
            band={done ? "found" : (hottest?.band ?? "frozen")}
            rank={done ? 0 : (hottest?.rank ?? null)}
            streak={streak.current}
            solved={done && !state.gaveUp}
          />
          <p>
            {done
              ? state.gaveUp
                ? "revealed"
                : `found in ${playerGuesses.length}`
              : hottest
                ? `hottest · #${hottest.rank.toLocaleString()}`
                : "0 · the secret word"}
            {!done && streak.current >= 3 ? (
              <span className="heat-source-streak"> · streak {streak.current}</span>
            ) : null}
          </p>
        </div>
        {showHow ? (
          <section
            id="how-heat-works"
            className="heat-explainer"
            aria-labelledby="heat-guide-title"
          >
            <h2 id="heat-guide-title">find the secret word.</h2>
            <p>
              Guess any word you think connects to the secret. Every accepted word gets a rank
              against the dictionary: lower is closer, and 0 is the answer.
            </p>
            <p className="heat-example-label">if the secret were car</p>
            <dl className="heat-examples">
              <div>
                <dt>truck</dt>
                <dd>
                  <strong>#12</strong> very close
                </dd>
              </div>
              <div>
                <dt>tire</dt>
                <dd>
                  <strong>#344</strong> close
                </dd>
              </div>
              <div>
                <dt>banana</dt>
                <dd>
                  <strong>#45,333</strong> far away
                </dd>
              </div>
            </dl>
            <p className="heat-guide-note">
              Connections can be meanings, categories, familiar pairs, or opposites. Names are not
              accepted; common forms such as “dogs” become “dog”.
            </p>
          </section>
        ) : null}
        <HeatLedger guesses={ledger} newestId={newest} target={state.target} />
        {done ? (
          <section className="pb-24 text-center">
            <HotAndColdResultShare
              id="daily-heat-result"
              label={`daily #${puzzle}`}
              guesses={playerGuesses}
              hintsUsed={state.hintsUsed}
              outcome={state.gaveUp ? "gave-up" : "found"}
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
                errorMessage="Couldn’t reveal the word. Try again."
                onGiveUp={giveUp}
              />
            </>
          }
        />
      ) : (
        <HotAndColdShareDock
          label={`daily #${puzzle}`}
          guesses={playerGuesses}
          hintsUsed={state.hintsUsed}
          resultId="daily-heat-result"
        />
      )}
    </div>
  );
}
