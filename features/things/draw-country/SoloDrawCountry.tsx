import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { CountryRevealAnalysis } from "./CountryReveal";
import { DrawCountryResultReport } from "./DrawCountryResultReport";
import { CountryRoundBoard } from "./CountryRoundBoard";
import { resultReaction } from "./result-copy";
import { nextSoloCountry, rememberCountry } from "./rotation.client";
import { scoreCountryDrawing } from "./scoring";
import type { CountryDrawing, CountryOutline } from "./types";

const ROUND_SECONDS = 30;

export function SoloDrawCountry({ onExit }: { onExit: () => void }) {
  const [country, setCountry] = useState<CountryOutline>(() => nextSoloCountry());
  const [phase, setPhase] = useState<"drawing" | "reveal">("drawing");
  const [drawing, setDrawing] = useState<CountryDrawing>([]);
  const [endsAt, setEndsAt] = useState(() => Date.now() + ROUND_SECONDS * 1_000);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const haptics = useWebHaptics();
  useUpdateReloadSafety("draw-country-solo", phase === "reveal");
  const evaluation = useMemo(
    () => (phase === "reveal" ? scoreCountryDrawing(country, drawing) : null),
    [country, drawing, phase],
  );

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const finish = useCallback(() => {
    setPhase("reveal");
    rememberCountry(country.id);
    void haptics.trigger("success");
  }, [country.id, haptics]);

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

  const playAgain = () => {
    setCountry(nextSoloCountry());
    setDrawing([]);
    setSeconds(ROUND_SECONDS);
    setEndsAt(Date.now() + ROUND_SECONDS * 1_000);
    setPhase("drawing");
    void haptics.trigger("selection");
  };

  if (phase === "drawing")
    return (
      <div className="things-game things-game--cream text-black">
        <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/50">
          <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
            ← game
          </button>
          <span>solo</span>
        </header>
        <CountryRoundBoard
          countryName={country.name}
          drawing={drawing}
          seconds={seconds}
          onChange={setDrawing}
          onDone={finish}
        />
      </div>
    );

  if (!evaluation) return null;

  return (
    <div className="things-game things-game--cream text-black">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 pt-3 font-mono text-xs text-black/50">
        <button type="button" onClick={onExit} className="inline-flex min-h-11 items-center">
          ← game
        </button>
        <Link to="/things" className="inline-flex min-h-11 items-center">
          things
        </Link>
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
          onClick={playAgain}
          className="mx-auto mt-8 block min-h-12 rounded-full bg-black px-8 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-white"
        >
          draw another
        </button>
      </main>
    </div>
  );
}
