import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { GAME_DECKS, shuffledCards } from "./decks";
import { playGameSound, primeGameAudio } from "./gameSound";
import { OrientationControls } from "./OrientationControls";
import { RoundPlayArea } from "./RoundPlayArea";
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
  const [positionLock, setPositionLock] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const processing = useRef(false);
  const roundPaused = useRef(false);
  const previousPauseReason = useRef<string | null>(null);
  const decisionTimeout = useRef<number | null>(null);
  const haptics = useWebHaptics();

  const selectedDeck = GAME_DECKS.find((deck) => deck.id === deckId) ?? GAME_DECKS[0];
  const card = cards[cardIndex] ?? selectedDeck.cards[0];
  const score = results.filter((result) => result.decision === "correct").length;

  const handleDecision = useCallback(
    (decision: Decision) => {
      if (phase !== "playing" || processing.current || roundPaused.current) return;
      processing.current = true;
      setFeedback(decision);
      setResults((current) => [...current, { card, decision }]);
      playGameSound(decision, soundEnabled);
      void haptics.trigger(decision === "correct" ? "success" : "nudge");

      decisionTimeout.current = window.setTimeout(() => {
        setCardIndex((current) => (current + 1) % cards.length);
        setFeedback(null);
        processing.current = false;
        decisionTimeout.current = null;
      }, 360);
    },
    [card, cards.length, haptics, phase, soundEnabled],
  );

  const {
    status: motionStatus,
    pauseReason: motionPauseReason,
    requestAccess,
    calibrate,
    settle,
    clearOrientationLock,
  } = useTiltControl(phase === "playing" && !feedback, handleDecision, positionLock);
  const pauseReason = interrupted ? "interrupted" : motionPauseReason;
  roundPaused.current = pauseReason !== null;

  const clearDecisionTimeout = useCallback(() => {
    if (decisionTimeout.current === null) return;
    window.clearTimeout(decisionTimeout.current);
    decisionTimeout.current = null;
  }, []);

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
    setInterrupted(false);
    clearDecisionTimeout();
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
    if (phase !== "playing" || pauseReason) return;
    const interval = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pauseReason, phase]);

  useEffect(() => {
    if (phase !== "playing" || seconds <= 0 || seconds > 5) return;
    playGameSound("tick", soundEnabled);
  }, [phase, seconds, soundEnabled]);

  useEffect(() => {
    if (phase !== "playing" || seconds !== 0) return;
    clearDecisionTimeout();
    playGameSound("end", soundEnabled);
    void haptics.trigger("heavy");
    clearOrientationLock();
    processing.current = false;
    setPhase("results");
  }, [clearDecisionTimeout, clearOrientationLock, haptics, phase, seconds, soundEnabled]);

  useEffect(() => {
    if (phase !== "playing") {
      previousPauseReason.current = null;
      return;
    }
    if (pauseReason && !previousPauseReason.current) {
      void haptics.trigger("nudge");
    } else if (!pauseReason && previousPauseReason.current) {
      void haptics.trigger("selection");
    }
    previousPauseReason.current = pauseReason;
  }, [haptics, pauseReason, phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") setInterrupted(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [phase]);

  useEffect(() => {
    if (phase === "playing") return;
    clearDecisionTimeout();
    processing.current = false;
  }, [clearDecisionTimeout, phase]);

  useEffect(() => clearDecisionTimeout, [clearDecisionTimeout]);

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
            {positionLock
              ? "Keep the phone in this position, screen facing your friends."
              : "Hold the phone against your forehead in portrait or landscape, screen facing your friends."}
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

        <RoundPlayArea
          card={card}
          feedback={feedback}
          pauseReason={pauseReason}
          onDecision={handleDecision}
          onResume={() => {
            setInterrupted(false);
            settle();
          }}
        />
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

        <OrientationControls
          locked={positionLock}
          motionUnavailable={motionStatus === "denied" || motionStatus === "unavailable"}
          onStart={() => void startRound()}
          onToggle={() => {
            setPositionLock((locked) => !locked);
            void haptics.trigger("selection");
          }}
        />
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
