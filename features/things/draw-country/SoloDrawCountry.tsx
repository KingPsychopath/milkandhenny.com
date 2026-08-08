import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { useWakeLock } from "@/hooks/useWakeLock";
import { CountryRevealAnalysis } from "./CountryReveal";
import { DrawCountryResultReport } from "./DrawCountryResultReport";
import { CountryRoundBoard } from "./CountryRoundBoard";
import { resultReaction } from "./result-copy";
import { nextSoloCountry, primeCountry, rememberCountry } from "./rotation.client";
import { scoreCountryDrawing, type CountryEvaluation } from "./scoring";
import type { CountryDrawing, CountryOutline } from "./types";

export type SoloDrawCountryMode = "quick" | "rounds";

interface SoloRoundResult {
  countryId: string;
  countryName: string;
  score: number;
}

export function SoloDrawCountry({
  initialCountry,
  onExit,
  mode = "quick",
  roundTotal = 5,
  roundSeconds = 30,
}: {
  initialCountry: CountryOutline;
  onExit: () => void;
  mode?: SoloDrawCountryMode;
  roundTotal?: number;
  roundSeconds?: number;
}) {
  const total = mode === "quick" ? 1 : Math.max(1, roundTotal);
  const [country, setCountry] = useState<CountryOutline>(initialCountry);
  const [phase, setPhase] = useState<"drawing" | "reveal" | "finished">("drawing");
  const [drawing, setDrawing] = useState<CountryDrawing>([]);
  const [evaluation, setEvaluation] = useState<CountryEvaluation | null>(null);
  const [results, setResults] = useState<SoloRoundResult[]>([]);
  const [endsAt, setEndsAt] = useState(() => Date.now() + roundSeconds * 1_000);
  const [seconds, setSeconds] = useState(roundSeconds);
  const finishedRound = useRef(false);
  const nextCountry = useRef<Promise<CountryOutline> | null>(null);
  const haptics = useWebHaptics();
  useUpdateReloadSafety("draw-country-solo", phase !== "drawing");
  useWakeLock(phase === "drawing");

  useEffect(() => primeCountry(initialCountry), [initialCountry]);

  useEffect(() => {
    if (phase === "drawing" && !nextCountry.current)
      nextCountry.current = nextSoloCountry(country.id);
  }, [country.id, phase]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase]);

  const finish = useCallback(() => {
    if (finishedRound.current) return;
    finishedRound.current = true;
    const nextEvaluation = scoreCountryDrawing(country, drawing);
    setEvaluation(nextEvaluation);
    setResults((current) => [
      ...current,
      { countryId: country.id, countryName: country.name, score: nextEvaluation.score },
    ]);
    setPhase("reveal");
    rememberCountry(country.id);
    void haptics.trigger("success");
  }, [country, drawing, haptics]);

  useEffect(() => {
    if (phase !== "drawing") return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));
      setSeconds(next);
      if (next === 0) finish();
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [endsAt, finish, phase]);

  const startNextRound = async () => {
    const countryPromise = nextCountry.current ?? nextSoloCountry();
    nextCountry.current = null;
    setCountry(await countryPromise);
    setDrawing([]);
    setEvaluation(null);
    setSeconds(roundSeconds);
    setEndsAt(Date.now() + roundSeconds * 1_000);
    finishedRound.current = false;
    setPhase("drawing");
    void haptics.trigger("selection");
  };

  const restartRounds = () => {
    setResults([]);
    void startNextRound();
  };

  if (phase === "drawing") {
    const roundNumber = results.length + 1;
    return (
      <div className="things-game things-game--cream text-black">
        <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/50">
          <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
            ← game
          </button>
          <span>{mode === "quick" ? "quick draw" : `solo · round ${roundNumber}/${total}`}</span>
        </header>
        <CountryRoundBoard
          countryName={country.name}
          roundLabel={mode === "rounds" ? `${roundNumber}/${total}` : undefined}
          drawing={drawing}
          seconds={seconds}
          onChange={setDrawing}
          onDone={finish}
        />
      </div>
    );
  }

  if (phase === "finished") {
    const points = results.reduce((sum, result) => sum + result.score, 0);
    const average = Math.round(points / Math.max(1, results.length));
    return (
      <div className="things-game things-game--cream text-black">
        <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/50">
          <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
            ← game
          </button>
          <Link to="/things" className="inline-flex min-h-11 items-center">
            things
          </Link>
        </header>
        <main
          id="main"
          className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 pb-16"
        >
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/40">
            {results.length} round solo
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <h1 className="font-serif text-5xl font-semibold">Your atlas.</h1>
            <div className="shrink-0 text-right">
              <p className="font-mono text-4xl font-semibold">{average}</p>
              <p className="font-mono text-micro text-black/40">average</p>
            </div>
          </div>
          <ol className="mt-8 divide-y divide-black/10 border-y border-black/15">
            {results.map((result, index) => (
              <li
                key={`${result.countryId}-${index}`}
                className="flex min-h-14 items-center gap-4 py-3"
              >
                <span className="w-6 font-mono text-xs text-black/35">{index + 1}</span>
                <span className="flex-1 font-serif text-lg font-semibold">
                  {result.countryName}
                </span>
                <span className="font-mono font-semibold">{result.score}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-center font-mono text-xs text-black/45">
            {points} points from {results.length * 100}
          </p>
          <button
            type="button"
            onClick={restartRounds}
            className="mt-7 min-h-12 rounded-full bg-black px-7 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white"
          >
            play {total} new rounds
          </button>
          <button
            type="button"
            onClick={onExit}
            className="mt-3 min-h-11 font-mono text-xs text-black/50"
          >
            back to game modes
          </button>
        </main>
      </div>
    );
  }

  if (!evaluation) return null;
  const roundComplete = mode === "rounds" && results.length >= total;

  return (
    <div className="things-game things-game--cream text-black">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/50">
        <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
          ← game
        </button>
        <span>{mode === "quick" ? "quick draw" : `round ${results.length}/${total}`}</span>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-12 pt-5">
        <div className="flex items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="font-mono text-micro uppercase tracking-[0.18em] text-black/45">
              {resultReaction(evaluation.score, country.id)}
            </p>
            <h1 className="mt-2 break-words font-serif text-4xl font-semibold sm:text-5xl">
              {country.name}
            </h1>
          </div>
          <p className="sr-only">Score {evaluation.score} out of 100</p>
          <div className="shrink-0 text-right" aria-hidden="true">
            <TextMorph as="p" className="font-mono text-4xl font-semibold sm:text-5xl">
              {String(evaluation.score)}
            </TextMorph>
            <p className="font-mono text-micro uppercase tracking-[0.15em] text-black/40">
              out of 100
            </p>
          </div>
        </div>
        <div className="mt-6">
          <CountryRevealAnalysis evaluation={evaluation} />
        </div>
        <DrawCountryResultReport countryId={country.id} drawing={drawing} mode="solo" />
        <button
          type="button"
          onClick={roundComplete ? () => setPhase("finished") : () => void startNextRound()}
          className="mx-auto mt-8 block min-h-12 rounded-full bg-black px-8 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-white"
        >
          {roundComplete ? "see round scores" : mode === "quick" ? "draw another" : "next country"}
        </button>
        {mode === "rounds" ? (
          <p className="mt-3 text-center font-mono text-micro text-black/40">
            {results.reduce((sum, result) => sum + result.score, 0)} points so far
          </p>
        ) : null}
      </main>
    </div>
  );
}
