import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { GAME_DECKS, shuffledCards } from "./decks";
import { playGameSound, primeGameAudio } from "./gameSound";
import { useTiltControl } from "./useTiltControl";

type Phase = "setup" | "countdown" | "playing" | "results";
type Decision = "correct" | "pass";

interface Result {
  card: string;
  decision: Decision;
}

const ROUND_SECONDS = 60;
const SNAP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function HeadsUpApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [deckId, setDeckId] = useState(GAME_DECKS[0].id);
  const [cards, setCards] = useState(() => shuffledCards(GAME_DECKS[0].cards));
  const [cardIndex, setCardIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [results, setResults] = useState<Result[]>([]);
  const [feedback, setFeedback] = useState<Decision | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const processing = useRef(false);
  const haptics = useWebHaptics();

  const selectedDeck = GAME_DECKS.find((deck) => deck.id === deckId) ?? GAME_DECKS[0];
  const card = cards[cardIndex] ?? selectedDeck.cards[0];
  const score = results.filter((result) => result.decision === "correct").length;

  const handleDecision = useCallback(
    (decision: Decision) => {
      if (phase !== "playing" || processing.current) return;
      processing.current = true;
      setFeedback(decision);
      setResults((current) => [...current, { card, decision }]);
      playGameSound(decision, soundEnabled);
      void haptics.trigger(decision === "correct" ? "success" : "nudge");

      window.setTimeout(() => {
        setCardIndex((current) => (current + 1) % cards.length);
        setFeedback(null);
        processing.current = false;
      }, 360);
    },
    [card, cards.length, haptics, phase, soundEnabled],
  );

  const {
    status: motionStatus,
    requestAccess,
    calibrate,
  } = useTiltControl(phase === "playing" && !feedback, handleDecision);

  const startRound = async () => {
    primeGameAudio();
    void haptics.trigger("medium");
    await requestAccess();
    setCards(shuffledCards(selectedDeck.cards));
    setCardIndex(0);
    setResults([]);
    setFeedback(null);
    setSeconds(ROUND_SECONDS);
    setCountdown(3);
    processing.current = false;
    setPhase("countdown");
  };

  useEffect(() => {
    if (phase !== "countdown") return;
    const timeout = window.setTimeout(() => {
      if (countdown <= 1) {
        calibrate();
        playGameSound("tick", soundEnabled);
        setPhase("playing");
      } else {
        playGameSound("tick", soundEnabled);
        setCountdown((current) => current - 1);
      }
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [calibrate, countdown, phase, soundEnabled]);

  useEffect(() => {
    if (phase !== "playing") return;
    const interval = window.setInterval(() => {
      setSeconds((current) => {
        const next = current - 1;
        if (next <= 0) {
          playGameSound("end", soundEnabled);
          void haptics.trigger("heavy");
          setPhase("results");
          return 0;
        }
        if (next <= 5) playGameSound("tick", soundEnabled);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [haptics, phase, soundEnabled]);

  if (phase === "countdown") {
    return (
      <GameShell tone="amber">
        <main id="main" className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-black/55">get ready</p>
          <TextMorph
            as="h1"
            duration={420}
            ease={SNAP_EASE}
            className="mt-2 font-serif text-[8rem] font-semibold leading-none text-black"
          >
            {String(countdown)}
          </TextMorph>
          <p className="mt-8 max-w-xs px-6 font-serif text-xl text-black/70">
            Hold the phone upright against your forehead, screen facing your friends.
          </p>
        </main>
      </GameShell>
    );
  }

  if (phase === "playing") {
    return (
      <GameShell tone={feedback === "correct" ? "green" : feedback === "pass" ? "stone" : "amber"}>
        <header className="grid grid-cols-3 items-center px-5 py-4 text-black">
          <span className="font-mono text-xs opacity-60">{selectedDeck.name}</span>
          <span
            className="justify-self-center rounded-full border border-black/15 px-4 py-2 font-mono text-lg font-semibold tabular-nums"
            aria-label={`${seconds} seconds remaining`}
          >
            {seconds}
          </span>
          <span className="justify-self-end font-mono text-xs opacity-60">{score} correct</span>
        </header>

        <main
          id="main"
          className="relative flex flex-1 flex-col items-center justify-center px-6 text-center text-black"
        >
          <div
            aria-live="polite"
            className="absolute top-5 font-mono text-sm font-semibold uppercase tracking-[0.2em]"
          >
            {feedback === "correct" ? "✓ correct" : feedback === "pass" ? "↑ pass" : ""}
          </div>
          <TextMorph
            as="h1"
            duration={320}
            ease={SNAP_EASE}
            className="max-w-3xl font-serif text-5xl font-semibold leading-[0.95] tracking-tight sm:text-7xl"
          >
            {card}
          </TextMorph>
          <p className="mt-8 font-mono text-micro uppercase tracking-[0.18em] text-black/50">
            down = correct · up = pass
          </p>
        </main>

        <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => handleDecision("pass")}
            className="min-h-14 rounded-full border border-black/20 bg-black/5 font-mono text-sm font-semibold text-black"
          >
            ↑ pass
          </button>
          <button
            type="button"
            onClick={() => handleDecision("correct")}
            className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white"
          >
            correct ↓
          </button>
        </footer>
      </GameShell>
    );
  }

  if (phase === "results") {
    return (
      <GameShell tone="cream">
        <header className="flex items-center justify-between p-5 font-mono text-xs text-black/55">
          <button type="button" onClick={() => setPhase("setup")} className="min-h-11">
            ← decks
          </button>
          <span>round complete</span>
        </header>
        <main id="main" className="flex-1 px-6 pb-10 text-black">
          <section className="mx-auto max-w-lg pt-8 text-center">
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/50">
              your score
            </p>
            <h1 className="mt-2 font-serif text-8xl font-semibold leading-none">{score}</h1>
            <p className="mt-3 font-serif text-xl text-black/65">
              {score >= 10
                ? "That was electric."
                : score >= 6
                  ? "Very respectable."
                  : "A fine warm-up."}
            </p>
            <button
              type="button"
              onClick={() => void startRound()}
              className="mt-7 min-h-14 w-full rounded-full bg-black px-6 font-mono text-sm font-semibold text-white"
            >
              play again
            </button>
          </section>

          <section className="mx-auto mt-10 max-w-lg" aria-labelledby="round-cards">
            <h2
              id="round-cards"
              className="font-mono text-micro uppercase tracking-[0.18em] text-black/50"
            >
              the cards
            </h2>
            <ul className="mt-3 border-t border-black/15">
              {results.map((result, index) => (
                <li
                  key={`${result.card}-${index}`}
                  className="flex items-center justify-between border-b border-black/15 py-3"
                >
                  <span className="font-serif text-lg">{result.card}</span>
                  <span className="font-mono text-xs text-black/50">
                    {result.decision === "correct" ? "correct ✓" : "passed ↑"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </GameShell>
    );
  }

  return (
    <GameShell tone="night">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="min-h-11 inline-flex items-center hover:text-white">
          ← things
        </Link>
        <button
          type="button"
          onClick={() => setSoundEnabled((enabled) => !enabled)}
          className="min-h-11 rounded-full px-2 hover:text-white"
          aria-pressed={soundEnabled}
        >
          sound {soundEnabled ? "on" : "off"}
        </button>
      </header>

      <main id="main" className="flex-1 px-5 pb-10 text-white">
        <section className="mx-auto max-w-lg pt-7">
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">
            a guessing game
          </p>
          <h1 className="mt-3 font-serif text-6xl font-semibold leading-none tracking-tight">
            Forehead.
          </h1>
          <p className="mt-5 max-w-md font-serif text-lg leading-relaxed text-white/65">
            Pick a deck. Your friends give clues. Tilt down when you get it, or up to pass.
          </p>
        </section>

        <section className="mx-auto mt-10 max-w-lg" aria-labelledby="choose-deck">
          <h2
            id="choose-deck"
            className="font-mono text-micro uppercase tracking-[0.18em] text-white/45"
          >
            choose a deck
          </h2>
          <div className="mt-3 grid gap-3">
            {GAME_DECKS.map((deck) => {
              const selected = deck.id === deckId;
              return (
                <button
                  type="button"
                  key={deck.id}
                  onClick={() => {
                    setDeckId(deck.id);
                    void haptics.trigger("selection");
                  }}
                  aria-pressed={selected}
                  className={`grid min-h-24 grid-cols-[2.75rem_1fr_auto] items-center gap-3 rounded-3xl border p-4 text-left transition-[transform,border-color,background-color] ${
                    selected ? "border-white/60 bg-white/12" : "border-white/12 bg-white/[0.04]"
                  }`}
                >
                  <span className="font-serif text-3xl text-white/65" aria-hidden="true">
                    {deck.symbol}
                  </span>
                  <span>
                    <span className="block font-serif text-xl font-semibold">{deck.name}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-white/50">
                      {deck.description}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-white/45">{deck.cards.length}</span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mx-auto mt-6 max-w-lg">
          <button
            type="button"
            onClick={() => void startRound()}
            className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black shadow-2xl transition-transform hover:scale-[1.01]"
          >
            start 60-second round
          </button>
          {motionStatus === "denied" || motionStatus === "unavailable" ? (
            <p className="mt-3 text-center font-mono text-micro text-white/45">
              motion unavailable — use the on-screen buttons
            </p>
          ) : null}
        </div>
      </main>
    </GameShell>
  );
}

function GameShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "night" | "amber" | "green" | "stone" | "cream";
}) {
  return <div className={`things-game things-game--${tone}`}>{children}</div>;
}
