import { useCallback, useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { customDeckAsGameDeck, formatDeckText, type CustomDeck } from "./customDecks";
import { CustomDeckBuilder } from "./CustomDeckBuilder";
import { GAME_DECKS, shuffledCards, type GameDeck } from "./decks";
import { playGameSound, primeGameAudio } from "./gameSound";
import { HeadsUpSetup } from "./HeadsUpSetup";
import { RoundPlayArea } from "./RoundPlayArea";
import { RoundResults, type RoundResult } from "./RoundResults";
import { useCustomDecks } from "./useCustomDecks";
import { useFullscreen } from "./useFullscreen";
import { useTiltControl } from "./useTiltControl";

type Phase = "setup" | "builder" | "countdown" | "playing" | "results";
type Decision = "correct" | "pass";

const ROUND_SECONDS = 60;
const SNAP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function HeadsUpApp() {
  const fullscreen = useFullscreen();

  return (
    <div ref={fullscreen.targetRef} className="things-game-fullscreen">
      <HeadsUpExperience fullscreen={fullscreen} />
    </div>
  );
}

interface FullscreenControls {
  active: boolean;
  installFallback: boolean;
  message: string | null;
  standalone: boolean;
  supported: boolean;
  toggle: () => Promise<void>;
}

function HeadsUpExperience({ fullscreen }: { fullscreen: FullscreenControls }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [deckId, setDeckId] = useState(GAME_DECKS[0].id);
  const [cards, setCards] = useState(() => shuffledCards(GAME_DECKS[0].cards));
  const [cardIndex, setCardIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [feedback, setFeedback] = useState<Decision | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [positionLock, setPositionLock] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomDeck | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const processing = useRef(false);
  const roundPaused = useRef(false);
  const previousPauseReason = useRef<string | null>(null);
  const decisionTimeout = useRef<number | null>(null);
  const haptics = useWebHaptics();
  const { customDecks, saveDeck, deleteDeck } = useCustomDecks();
  const allDecks = [...GAME_DECKS, ...customDecks.map(customDeckAsGameDeck)];

  const selectedDeck = allDecks.find((deck) => deck.id === deckId) ?? GAME_DECKS[0];
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

  const startRound = async (deck: GameDeck = selectedDeck) => {
    primeGameAudio();
    void haptics.trigger("medium");
    await requestAccess();
    setCards(shuffledCards(deck.cards));
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

  const handleShareDeck = async (id: string) => {
    const deck = customDecks.find((current) => current.id === id);
    if (!deck) return;
    const text = formatDeckText(deck);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Forehead deck: ${deck.name}`, text });
        setShareMessage("Shared.");
      } else {
        await navigator.clipboard.writeText(text);
        setShareMessage("Copied — paste it into Notes or Keep.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(text);
        setShareMessage("Copied — paste it wherever you like.");
      } catch {
        setShareMessage("Open edit and copy the list from there.");
      }
    }
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

  if (phase === "builder") {
    return (
      <CustomDeckBuilder
        deck={editingDeck}
        onCancel={() => setPhase("setup")}
        onDelete={(deck) => {
          if (!window.confirm(`Delete “${deck.name}”?`)) return;
          deleteDeck(deck.id);
          setDeckId(GAME_DECKS[0].id);
          setEditingDeck(null);
          setPhase("setup");
        }}
        onSave={(deck) => {
          saveDeck(deck);
          setDeckId(deck.id);
          setEditingDeck(deck);
          void haptics.trigger("success");
          void startRound(customDeckAsGameDeck(deck));
        }}
      />
    );
  }

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
          <span className="min-w-0 truncate font-mono text-xs opacity-60">{selectedDeck.name}</span>
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
      <RoundResults
        results={results}
        score={score}
        onBack={() => setPhase("setup")}
        onPlayAgain={() => void startRound()}
      />
    );
  }

  return (
    <HeadsUpSetup
      decks={allDecks}
      fullscreenActive={fullscreen.active}
      fullscreenInstallFallback={fullscreen.installFallback}
      fullscreenMessage={fullscreen.message}
      fullscreenStandalone={fullscreen.standalone}
      fullscreenSupported={fullscreen.supported}
      locked={positionLock}
      motionUnavailable={motionStatus === "denied" || motionStatus === "unavailable"}
      selectedDeckId={deckId}
      soundEnabled={soundEnabled}
      customDeckIds={new Set(customDecks.map((deck) => deck.id))}
      shareMessage={shareMessage}
      onCreateDeck={() => {
        setEditingDeck(null);
        setPhase("builder");
      }}
      onEditDeck={(id) => {
        setEditingDeck(customDecks.find((deck) => deck.id === id) ?? null);
        setPhase("builder");
      }}
      onFullscreen={() => void fullscreen.toggle()}
      onSelectDeck={(id) => {
        setDeckId(id);
        setShareMessage(null);
        void haptics.trigger("selection");
      }}
      onShareDeck={(id) => void handleShareDeck(id)}
      onStart={() => void startRound()}
      onToggleLock={() => {
        setPositionLock((locked) => !locked);
        void haptics.trigger("selection");
      }}
      onToggleSound={() => setSoundEnabled((enabled) => !enabled)}
    />
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
