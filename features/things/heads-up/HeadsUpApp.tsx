import { useCallback, useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { customDeckAsGameDeck, formatDeckText, type CustomDeck } from "./customDecks";
import { CustomDeckBuilder } from "./CustomDeckBuilder";
import { GAME_DECKS, shuffledCards, type GameDeck } from "./decks";
import { playGameSound, primeGameAudio } from "../shared/game-sound.client";
import { HeadsUpSetup } from "./HeadsUpSetup";
import { RoundPlayArea } from "./RoundPlayArea";
import { RoundResults, type RoundResult } from "./RoundResults";
import { useCustomDecks } from "./useCustomDecks";
import { useFullscreen } from "../shared/useFullscreen";
import { useTiltControl } from "../shared/useTiltControl";
import { RemoteConnectionBadge, PairedGameHostPanel } from "../remote/PairedGameHostPanel";
import { PairedGamePlayerReady } from "../remote/PairedGamePlayerReady";
import { usePairedGameRoom } from "../remote/usePairedGameRoom";
import type { RemoteCommand, RemoteGameSnapshot, RemoteHeadsUpSetup, RemotePlayerSession } from "../remote/types";
import { GameShell } from "../shared/GameShell";
import { EndGameDialog } from "../shared/EndGameDialog";
import { shareOrCopy } from "@/lib/client/share";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";

type Phase = "setup" | "builder" | "countdown" | "playing" | "results";
type Decision = "correct" | "pass";

const ROUND_SECONDS = 60;
const SNAP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const ROUND_STORAGE_KEY = "forehead:active-round:v1";

export function HeadsUpApp({ remoteSession }: { remoteSession?: RemotePlayerSession } = {}) {
  const fullscreen = useFullscreen();

  return (
    <div ref={fullscreen.targetRef} className="things-game-fullscreen">
      <HeadsUpExperience fullscreen={fullscreen} remoteSession={remoteSession} />
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

function HeadsUpExperience({ fullscreen, remoteSession }: { fullscreen: FullscreenControls; remoteSession?: RemotePlayerSession }) {
  const roundStorageKey = remoteSession ? `${ROUND_STORAGE_KEY}:${remoteSession.roomId}` : ROUND_STORAGE_KEY;
  const joinedSetup = remoteSession?.setup.game === "heads-up" ? remoteSession.setup : null;
  const joinedDeck: GameDeck | null = joinedSetup ? {
    id: `remote-${remoteSession?.roomId ?? "player"}`,
    name: joinedSetup.deck.name,
    description: "Prepared by your judge.",
    symbol: "↗",
    cards: joinedSetup.deck.cards,
  } : null;
  const [phase, setPhase] = useState<Phase>("setup");
  useUpdateReloadSafety("heads-up-round", phase === "setup" || phase === "results");
  const [deckId, setDeckId] = useState(joinedDeck?.id ?? GAME_DECKS[0].id);
  const [cards, setCards] = useState(() => shuffledCards(joinedDeck?.cards ?? GAME_DECKS[0].cards));
  const [cardIndex, setCardIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [seconds, setSeconds] = useState(ROUND_SECONDS);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [feedback, setFeedback] = useState<Decision | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [positionLock, setPositionLock] = useState(joinedSetup?.positionLock ?? false);
  const [interrupted, setInterrupted] = useState(false);
  const [remotePaused, setRemotePaused] = useState(false);
  const [remoteExclusive, setRemoteExclusive] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomDeck | null>(null);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const processing = useRef(false);
  const roundPaused = useRef(false);
  const previousPauseReason = useRef<string | null>(null);
  const decisionTimeout = useRef<number | null>(null);
  const restoredRound = useRef(false);
  const haptics = useWebHaptics();
  const { customDecks, saveDeck, deleteDeck } = useCustomDecks();
  const allDecks = joinedDeck ? [joinedDeck] : [...GAME_DECKS, ...customDecks.map(customDeckAsGameDeck)];

  const selectedDeck = allDecks.find((deck) => deck.id === deckId) ?? GAME_DECKS[0];
  const card = cards[cardIndex] ?? selectedDeck.cards[0];
  const score = results.filter((result) => result.decision === "correct").length;

  const handleDecision = useCallback(
    (decision: Decision) => {
      if (phase !== "playing" || processing.current || roundPaused.current) return;
      processing.current = true;
      setFeedback(decision);
      setResults((current) => [...current, { id: crypto.randomUUID(), card, decision }]);
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
  } = useTiltControl(
    phase === "playing" && !feedback && !remoteExclusive,
    handleDecision,
    positionLock,
  );
  const pauseReason = remotePaused ? "remote" : interrupted ? "interrupted" : motionPauseReason;
  useEffect(() => {
    roundPaused.current = pauseReason !== null || endConfirmationOpen;
  }, [endConfirmationOpen, pauseReason]);

  const clearDecisionTimeout = useCallback(() => {
    if (decisionTimeout.current === null) return;
    window.clearTimeout(decisionTimeout.current);
    decisionTimeout.current = null;
  }, []);

  const endRound = useCallback(() => {
    setEndConfirmationOpen(false);
    clearDecisionTimeout();
    clearOrientationLock();
    processing.current = false;
    setFeedback(null);
    setResults([]);
    setInterrupted(false);
    setRemotePaused(false);
    sessionStorage.removeItem(roundStorageKey);
    restoredRound.current = false;
    setPhase("setup");
  }, [clearDecisionTimeout, clearOrientationLock, roundStorageKey]);

  const undoDecision = useCallback(() => {
    if (phase !== "playing" || results.length === 0) return;
    const cardAlreadyAdvanced = decisionTimeout.current === null;
    clearDecisionTimeout();
    setResults((current) => current.slice(0, -1));
    if (cardAlreadyAdvanced) setCardIndex((current) => (current - 1 + cards.length) % cards.length);
    setFeedback(null);
    processing.current = false;
  }, [cards.length, clearDecisionTimeout, phase, results.length]);

  const handleRemoteCommand = useCallback(
    (command: RemoteCommand) => {
      if (command.type === "correct") return handleDecision("correct");
      if (command.type === "pass" || command.type === "incorrect") return handleDecision("pass");
      if (command.type === "pause") return setRemotePaused(true);
      if (command.type === "resume") return setRemotePaused(false);
      if (command.type === "undo") return undoDecision();
      if (command.type !== "amend") return;
      setResults((current) =>
        current.map((result) =>
          result.id === command.resultId
            ? { ...result, decision: command.decision === "correct" ? "correct" : "pass" }
            : result,
        ),
      );
    },
    [handleDecision, undoDecision],
  );

  const remoteSnapshot: RemoteGameSnapshot = {
    game: "heads-up",
    phase: phase === "builder" ? "setup" : phase,
    deckName: selectedDeck.name,
    currentLabel: phase === "playing" ? card : null,
    nextLabel: phase === "playing" ? cards[(cardIndex + 1) % cards.length] ?? null : null,
    secondsRemaining: phase === "playing" ? seconds : null,
    paused: pauseReason !== null,
    transitioning: feedback !== null,
    pauseReason: pauseReason ?? undefined,
    score,
    results: results.map((result) => ({
      id: result.id,
      label: result.card,
      decision: result.decision,
    })),
    itemKey: phase === "playing" ? String(cardIndex) : undefined,
    updatedAt: Date.now(),
  };
  const remoteSetup: RemoteHeadsUpSetup = {
    game: "heads-up",
    deck: { name: selectedDeck.name, cards: [...selectedDeck.cards] },
    positionLock,
  };
  const remote = usePairedGameRoom("heads-up", remoteSetup, remoteSnapshot, handleRemoteCommand, remoteSession);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(roundStorageKey) ?? "null");
      if (!stored || typeof stored !== "object") return;
      const value = stored as {
        phase?: Phase;
        deckId?: string;
        cards?: unknown;
        cardIndex?: number;
        seconds?: number;
        results?: unknown;
        savedAt?: number;
      };
      if (!value.savedAt || Date.now() - value.savedAt > 2 * 60 * 60 * 1000) return;
      if (!Array.isArray(value.cards) || value.cards.length === 0 || !value.cards.every((card) => typeof card === "string")) return;
      if (!Array.isArray(value.results)) return;
      const restoredResults = value.results.filter((result): result is RoundResult => {
        if (!result || typeof result !== "object") return false;
        const entry = result as Partial<RoundResult>;
        return typeof entry.id === "string" && typeof entry.card === "string" && (entry.decision === "correct" || entry.decision === "pass");
      });
      if (value.phase !== "playing" && value.phase !== "countdown" && value.phase !== "results") return;
      setDeckId(typeof value.deckId === "string" ? value.deckId : GAME_DECKS[0].id);
      setCards(value.cards);
      setCardIndex(typeof value.cardIndex === "number" ? Math.max(0, Math.min(value.cardIndex, value.cards.length - 1)) : 0);
      setSeconds(typeof value.seconds === "number" ? Math.max(0, value.seconds) : ROUND_SECONDS);
      setResults(restoredResults);
      setPhase(value.phase === "countdown" ? "playing" : value.phase);
      if (value.phase !== "results") setInterrupted(true);
      restoredRound.current = true;
    } catch {
      sessionStorage.removeItem(roundStorageKey);
    }
  }, [roundStorageKey]);

  useEffect(() => {
    if (phase === "setup" || phase === "builder") {
      if (restoredRound.current) sessionStorage.removeItem(roundStorageKey);
      return;
    }
    sessionStorage.setItem(roundStorageKey, JSON.stringify({ phase, deckId, cards, cardIndex, seconds, results, savedAt: Date.now() }));
    restoredRound.current = true;
  }, [cardIndex, cards, deckId, phase, results, roundStorageKey, seconds]);

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
    setRemotePaused(false);
    clearDecisionTimeout();
    processing.current = false;
    setPhase("countdown");
  };

  const handleShareDeck = async (id: string) => {
    const deck = customDecks.find((current) => current.id === id);
    if (!deck) return;
    const text = formatDeckText(deck);
    const result = await shareOrCopy({ title: `Forehead deck: ${deck.name}`, text });
    if (result === "shared") setShareMessage("Shared.");
    else if (result === "copied") setShareMessage("Copied — paste it wherever you like.");
    else if (result === "failed") setShareMessage("Open edit and copy the list from there.");
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
    if (phase !== "playing" || pauseReason || endConfirmationOpen) return;
    const interval = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [endConfirmationOpen, pauseReason, phase]);

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
        <header className="p-5"><button type="button" onClick={() => setEndConfirmationOpen(true)} className="min-h-11 font-mono text-xs text-black/60">← cancel round</button></header>
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
        {endConfirmationOpen ? <EndGameDialog tone="light" eyebrow="cancel round" title="Cancel this round?" description="The round will return to setup before play begins." cancelLabel="keep counting" confirmLabel="cancel round" onCancel={() => setEndConfirmationOpen(false)} onConfirm={endRound} /> : null}
      </GameShell>
    );
  }

  if (phase === "playing") {
    return (
      <GameShell tone={feedback === "correct" ? "green" : feedback === "pass" ? "stone" : "amber"}>
        <header className="grid grid-cols-3 items-center px-5 py-4 text-black">
          <button type="button" onClick={() => setEndConfirmationOpen(true)} className="min-h-11 justify-self-start rounded-full border border-black/20 px-3 font-mono text-xs">end round</button>
          <span
            className="justify-self-center rounded-full border border-black/15 px-4 py-2 font-mono text-lg font-semibold tabular-nums"
            aria-label={`${seconds} seconds remaining`}
          >
            {seconds}
          </span>
          <span className="flex items-center justify-self-end gap-2 font-mono text-xs opacity-60">
            <RemoteConnectionBadge connected={remote.judgeConnected} />
            {score} correct
          </span>
        </header>

        <RoundPlayArea
          card={card}
          controlsLocked={remoteExclusive && remote.room !== null}
          feedback={feedback}
          pauseReason={pauseReason}
          onDecision={handleDecision}
          onEnd={() => setEndConfirmationOpen(true)}
          onResume={() => {
            if (remotePaused) {
              setRemotePaused(false);
              return;
            }
            setInterrupted(false);
            settle();
          }}
        />
        {endConfirmationOpen ? <EndGameDialog tone="light" eyebrow="end round" title="Leave this game?" description="Your cards and score from this round will be cleared." confirmLabel="end round" onCancel={() => setEndConfirmationOpen(false)} onConfirm={endRound} /> : null}
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

  if (joinedDeck) {
    return <PairedGamePlayerReady gameName="Forehead" deckName={joinedDeck.name} detail="Hold this phone to your forehead. Starting may ask for motion access so tilting can score each card." judgeConnected={remote.judgeConnected} onFullscreen={() => void fullscreen.toggle()} onLeave={remote.closeRoom} onStart={() => void startRound(joinedDeck)} />;
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
      remoteControls={
        <PairedGameHostPanel
          gameLabel="Forehead"
          inviteUrl={remote.inviteUrl}
          roomId={remote.room?.roomId ?? null}
          connected={remote.judgeConnected}
          syncing={remote.syncing}
          message={remote.message}
          exclusive={remoteExclusive}
          onCreate={remote.createRoom}
          onCreatePlayerRoom={remote.createJudgeRoom}
          onClose={remote.closeRoom}
          onMessage={remote.setMessage}
          onToggleExclusive={() => setRemoteExclusive((value) => !value)}
        />
      }
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
