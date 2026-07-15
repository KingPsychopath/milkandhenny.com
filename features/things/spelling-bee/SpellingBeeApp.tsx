import { useCallback, useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { playGameSound, primeGameAudio } from "../heads-up/gameSound";
import { RemoteConnectionBadge, RemoteHostPanel } from "../remote/RemoteHostPanel";
import { RemotePlayerReady } from "../remote/RemotePlayerReady";
import { useRemotePlayerRoom } from "../remote/useRemotePlayerRoom";
import type { RemoteCommand, RemoteGameSnapshot, RemotePlayerSession, RemoteSpellingSetup } from "../remote/types";
import { GameShell } from "../shared/GameShell";
import { useFullscreen } from "../shared/useFullscreen";
import { useTiltControl } from "../shared/useTiltControl";
import { customSpellingDeckAsDeck, type CustomSpellingDeck } from "./customDecks";
import { SPELLING_DECKS, shuffledWords, type SpellingDeck } from "./decks";
import { cancelLocalSpeech, speakWord } from "./localSpeech";
import { SpellingDeckBuilder } from "./SpellingDeckBuilder";
import { SpellingPlayArea } from "./SpellingPlayArea";
import { SpellingResults, type SpellingResult } from "./SpellingResults";
import { SpellingSetup } from "./SpellingSetup";
import { useCustomSpellingDecks } from "./useCustomSpellingDecks";
import { useLocalSpellingAssistant } from "./useLocalSpellingAssistant";
import { rememberSpellingWords, selectSpellingRoundWords } from "./wordRotation.client";
import { activeWord, feedbackDurationMs, remainingWordMs, type AloudDecision, type AloudEvaluationReason, type AloudWordState } from "./aloud-word-state";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";

type Phase = "setup" | "builder" | "countdown" | "playing" | "results";
const ROUND_STORAGE_KEY = "spelling-bee:active-round:v1";
const JUDGE_DECISION_GRACE_MS = 1_000;
const FINAL_SYNC_BUDGET_MS = 120;

export function SpellingBeeApp({ remoteSession }: { remoteSession?: RemotePlayerSession } = {}) {
  const fullscreen = useFullscreen();
  return <div ref={fullscreen.targetRef} className="things-game-fullscreen"><SpellingBeeExperience remoteSession={remoteSession} /></div>;
}

function SpellingBeeExperience({ remoteSession }: { remoteSession?: RemotePlayerSession }) {
  const roundStorageKey = remoteSession ? `${ROUND_STORAGE_KEY}:${remoteSession.roomId}` : ROUND_STORAGE_KEY;
  const joinedSetup = remoteSession?.setup.game === "spelling-bee" ? remoteSession.setup : null;
  const joinedDeck: SpellingDeck | null = joinedSetup ? {
    id: `remote-${remoteSession?.roomId ?? "player"}`,
    name: joinedSetup.deck.name,
    description: "Prepared by your judge.",
    symbol: "↗",
    words: joinedSetup.deck.words,
  } : null;
  const [phase, setPhase] = useState<Phase>("setup");
  useUpdateReloadSafety("spelling-bee-round", phase === "setup" || phase === "builder" || phase === "results");
  const [deckId, setDeckId] = useState(joinedDeck?.id ?? SPELLING_DECKS[0].id);
  const [words, setWords] = useState(() => shuffledWords(joinedDeck?.words ?? SPELLING_DECKS[0].words));
  const [wordIndex, setWordIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timerSeconds, setTimerSeconds] = useState(joinedSetup?.timerSeconds ?? 30);
  const [roundTotal, setRoundTotal] = useState(joinedSetup?.roundWordCount ?? 5);
  const [seconds, setSeconds] = useState<number | null>(joinedSetup?.timerSeconds ?? 30);
  const [results, setResults] = useState<SpellingResult[]>([]);
  const [feedback, setFeedback] = useState<AloudDecision | null>(null);
  const [wordState, setWordState] = useState<AloudWordState>({ status: "idle" });
  const [autoSpeak, setAutoSpeak] = useState(joinedSetup?.autoSpeak ?? true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [remoteExclusive, setRemoteExclusive] = useState(Boolean(remoteSession));
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomSpellingDeck | null>(null);
  const processing = useRef(false);
  const transitionTimeout = useRef<number | null>(null);
  const wordStateRef = useRef(wordState);
  const restoredRound = useRef(false);
  const haptics = useWebHaptics();
  const {
    status: assistantStatus,
    backend: assistantBackend,
    browserAvailability: browserSpeechAvailability,
    progress: assistantProgress,
    inputLevel: assistantInputLevel,
    match: assistantMatch,
    message: assistantMessage,
    downloadEstimate,
    enable: enableAssistant,
    disable: disableAssistant,
    start: startAssistant,
    stop: stopAssistant,
    retry: retryAssistant,
  } = useLocalSpellingAssistant();
  const transcript = assistantMatch.letters;
  const { customDecks, saveDeck, deleteDeck } = useCustomSpellingDecks();
  const allDecks = joinedDeck ? [joinedDeck] : [...SPELLING_DECKS, ...customDecks.map(customSpellingDeckAsDeck)];
  const selectedDeck = allDecks.find(({ id }) => id === deckId) ?? SPELLING_DECKS[0];
  const item = words[wordIndex] ?? selectedDeck.words[0];
  const score = results.filter(({ decision }) => decision === "correct").length;
  const presenting = wordState.status === "presenting";
  const paused = wordState.status === "paused";
  const evaluating = wordState.status === "local-evaluation";
  const evaluationReason = evaluating ? wordState.reason : null;
  wordStateRef.current = wordState;

  const clearTransition = useCallback(() => {
    if (transitionTimeout.current === null) return;
    window.clearTimeout(transitionTimeout.current);
    transitionTimeout.current = null;
  }, []);

  const completeWord = useCallback((decision: AloudDecision) => {
    const decisionState = wordState.status === "active" || wordState.status === "local-evaluation" || wordState.status === "remote-grace";
    if (phase !== "playing" || processing.current || !decisionState) return;
    processing.current = true;
    stopAssistant();
    setWordState({ status: "feedback", decision });
    setFeedback(decision);
    setResults((current) => [...current, { id: crypto.randomUUID(), wordId: item.id, word: item.word, decision, transcript: transcript || undefined }]);
    playGameSound(decision === "correct" ? "correct" : "pass", soundEnabled);
    void haptics.trigger(decision === "correct" ? "success" : "nudge");
    transitionTimeout.current = window.setTimeout(() => {
      if (wordIndex + 1 >= words.length) {
        cancelLocalSpeech();
        setPhase("results");
      } else {
        setWordIndex((current) => current + 1);
      }
      setFeedback(null);
      setWordState({ status: "idle" });
      processing.current = false;
      transitionTimeout.current = null;
    }, feedbackDurationMs(decision));
  }, [haptics, item.id, item.word, phase, soundEnabled, stopAssistant, transcript, wordIndex, wordState.status, words.length]);

  const undoDecision = useCallback(() => {
    if (phase !== "playing" || results.length === 0) return;
    clearTransition();
    setResults((current) => current.slice(0, -1));
    setWordIndex((current) => Math.max(0, current - 1));
    setFeedback(null);
    setWordState({ status: "idle" });
    processing.current = false;
  }, [clearTransition, phase, results.length]);

  const handleRemoteCommand = useCallback((command: RemoteCommand) => {
    if (command.type === "correct") return completeWord("correct");
    if (command.type === "incorrect") return completeWord("incorrect");
    if (command.type === "skip") return completeWord("skipped");
    if (command.type === "pass") return completeWord("skipped");
    if (command.type === "pause") return setWordState((current) => ({ status: "paused", remainingMs: remainingWordMs(current) }));
    if (command.type === "resume") { setWordState((current) => activeWord(current.status === "paused" && current.remainingMs !== undefined ? current.remainingMs / 1_000 : timerSeconds)); return; }
    if (command.type === "undo") return undoDecision();
    if (command.type !== "amend") return;
    const decision = command.decision === "pass" ? "skipped" : command.decision;
    setResults((current) => current.map((result) => result.id === command.resultId ? { ...result, decision } : result));
  }, [completeWord, timerSeconds, undoDecision]);

  const { requestAccess, calibrate } = useTiltControl(
    phase === "playing" && !feedback && wordState.status === "active" && !remoteExclusive,
    (decision) => completeWord(decision === "correct" ? "correct" : "skipped"),
    false,
  );

  const remoteSnapshot: RemoteGameSnapshot = {
    game: "spelling-bee",
    phase: phase === "builder" ? "setup" : phase,
    deckName: selectedDeck.name,
    currentLabel: phase === "playing" ? item.word : null,
    currentDefinition: phase === "playing" ? item.definition : undefined,
    currentPartOfSpeech: phase === "playing" ? item.partOfSpeech : undefined,
    nextLabel: phase === "playing" ? words[wordIndex + 1]?.word ?? null : null,
    secondsRemaining: phase === "playing" ? seconds : null,
    decisionClosesAt: wordState.status === "active" ? wordState.decisionClosesAt : wordState.status === "remote-grace" ? wordState.decisionClosesAt : undefined,
    decisionGraceEndsAt: wordState.status === "active" && wordState.decisionClosesAt ? wordState.decisionClosesAt + JUDGE_DECISION_GRACE_MS : wordState.status === "remote-grace" ? wordState.graceEndsAt : undefined,
    paused,
    transitioning: feedback !== null || presenting,
    pauseReason: wordState.status === "remote-grace" ? "checking final decisions" : evaluationReason === "time-up" ? "time is up" : evaluationReason === "possibly-complete" || (wordState.status === "active" && wordState.assistantSignal) ? "possibly complete" : paused ? "paused" : undefined,
    score,
    results: results.map((result) => ({ id: result.id, label: result.word, decision: result.decision })),
    transcript: transcript || undefined,
    itemKey: phase === "playing" ? `${wordIndex}:${item.id}` : undefined,
    updatedAt: Date.now(),
  };
  const remoteSetup: RemoteSpellingSetup = {
    game: "spelling-bee",
    deck: { name: selectedDeck.name, words: selectedDeck.words.map((word) => ({ ...word })) },
    timerSeconds,
    roundWordCount: Math.min(roundTotal, selectedDeck.words.length),
    autoSpeak,
  };
  const remote = useRemotePlayerRoom("spelling-bee", remoteSetup, remoteSnapshot, handleRemoteCommand, remoteSession);
  const remoteSyncNow = remote.syncNow;

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(roundStorageKey) ?? "null");
      if (!stored || typeof stored !== "object") return;
      const value = stored as { phase?: Phase; deckId?: string; words?: unknown; wordIndex?: number; seconds?: number | null; results?: unknown; timerSeconds?: number; roundTotal?: number; savedAt?: number; decisionClosesAt?: number; remoteExclusive?: boolean };
      if (!value.savedAt || Date.now() - value.savedAt > 2 * 60 * 60 * 1000) { sessionStorage.removeItem(roundStorageKey); return; }
      if (!Array.isArray(value.words) || !value.words.every((entry) => entry && typeof entry === "object" && typeof (entry as { word?: unknown }).word === "string")) { sessionStorage.removeItem(roundStorageKey); return; }
      if (!Array.isArray(value.results)) { sessionStorage.removeItem(roundStorageKey); return; }
      const restoredResults = value.results.filter((result): result is SpellingResult => {
        if (!result || typeof result !== "object") return false;
        const entry = result as Partial<SpellingResult>;
        return typeof entry.id === "string" && typeof entry.wordId === "string" && typeof entry.word === "string" && (entry.decision === "correct" || entry.decision === "incorrect" || entry.decision === "skipped" || entry.decision === "timed_out");
      });
      if (value.phase !== "playing" && value.phase !== "countdown" && value.phase !== "results") { sessionStorage.removeItem(roundStorageKey); return; }
      setDeckId(typeof value.deckId === "string" ? value.deckId : SPELLING_DECKS[0].id);
      setWords(value.words as typeof words);
      setWordIndex(typeof value.wordIndex === "number" ? Math.max(0, Math.min(value.wordIndex, value.words.length - 1)) : 0);
      setSeconds(typeof value.seconds === "number" ? Math.max(0, value.seconds) : null);
      setTimerSeconds(typeof value.timerSeconds === "number" ? value.timerSeconds : 30);
      setRoundTotal(typeof value.roundTotal === "number" ? Math.max(1, Math.min(value.words.length, value.roundTotal)) : value.words.length);
      setResults(restoredResults);
      if (typeof value.remoteExclusive === "boolean") setRemoteExclusive(value.remoteExclusive);
      setPhase(value.phase === "countdown" ? "playing" : value.phase);
      if (value.phase !== "results") setWordState({ status: "paused", remainingMs: typeof value.decisionClosesAt === "number" ? Math.max(0, value.decisionClosesAt - Date.now()) : typeof value.seconds === "number" ? value.seconds * 1_000 : undefined });
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
    sessionStorage.setItem(roundStorageKey, JSON.stringify({ phase, deckId, words, wordIndex, seconds, results, timerSeconds, roundTotal, remoteExclusive, decisionClosesAt: wordState.status === "active" ? wordState.decisionClosesAt : undefined, savedAt: Date.now() }));
    restoredRound.current = true;
  }, [deckId, phase, remoteExclusive, results, roundStorageKey, roundTotal, seconds, timerSeconds, wordIndex, wordState, words]);

  const startRound = useCallback(async (deck: SpellingDeck = selectedDeck) => {
    primeGameAudio();
    stopAssistant();
    cancelLocalSpeech();
    const selectedWords = selectSpellingRoundWords(deck.id, deck.words, Math.min(roundTotal, deck.words.length));
    rememberSpellingWords(deck.id, selectedWords.map(({ id }) => id), deck.words.length);
    setWords(selectedWords);
    setWordIndex(0);
    setResults([]);
    setFeedback(null);
    setWordState({ status: "idle" });
    setCountdown(3);
    setSeconds(timerSeconds || null);
    processing.current = false;
    clearTransition();
    await requestAccess();
    void haptics.trigger("medium");
    setPhase("countdown");
  }, [clearTransition, haptics, requestAccess, roundTotal, selectedDeck, stopAssistant, timerSeconds]);

  const endRound = useCallback((confirmFirst = true) => {
    if (confirmFirst) { setEndConfirmationOpen(true); return; }
    setEndConfirmationOpen(false);
    clearTransition();
    cancelLocalSpeech();
    stopAssistant();
    processing.current = false;
    setFeedback(null);
    setResults([]);
    setWordState({ status: "idle" });
    sessionStorage.removeItem(roundStorageKey);
    restoredRound.current = false;
    setPhase("setup");
  }, [clearTransition, roundStorageKey, stopAssistant]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const timeout = window.setTimeout(() => {
      playGameSound("tick", soundEnabled);
      if (countdown <= 1) { calibrate(); setPhase("playing"); }
      else setCountdown((current) => current - 1);
    }, 850);
    return () => window.clearTimeout(timeout);
  }, [calibrate, countdown, phase, soundEnabled]);

  useEffect(() => {
    if (phase !== "playing") return;
    setSeconds(timerSeconds || null);
    if (!autoSpeak) { setWordState(activeWord(timerSeconds)); return; }
    let active = true;
    setWordState({ status: "presenting" });
    void speakWord(item).finally(() => { if (active) setWordState(activeWord(timerSeconds)); });
    return () => { active = false; cancelLocalSpeech(); };
  }, [autoSpeak, item, phase, timerSeconds]);

  useEffect(() => {
    if (!paused) return;
    cancelLocalSpeech();
  }, [paused]);

  useEffect(() => {
    if (phase !== "playing" || wordState.status !== "active" || feedback || assistantStatus !== "ready") return;
    void startAssistant(item.word);
  }, [assistantStatus, feedback, item.word, phase, startAssistant, wordState.status]);

  useEffect(() => {
    if (phase !== "playing" || !assistantMatch.complete || wordState.status !== "active" || wordState.assistantSignal) return;
    stopAssistant();
    if (remoteExclusive && remote.room) setWordState((current) => current.status === "active" ? { ...current, assistantSignal: true } : current);
    else setWordState({ status: "local-evaluation", reason: "possibly-complete", remainingMs: remainingWordMs(wordState) });
    void haptics.trigger("selection");
  }, [assistantMatch.complete, haptics, phase, remote.room, remoteExclusive, stopAssistant, wordState]);

  useEffect(() => {
    if (phase !== "playing" || wordState.status !== "active" || wordState.decisionClosesAt === undefined) return;
    const update = () => {
      const remaining = Math.max(0, wordState.decisionClosesAt! - Date.now());
      setSeconds(Math.ceil(remaining / 1_000));
      if (remaining > 0) return;
      playGameSound("end", soundEnabled);
      void haptics.trigger("heavy");
      if (remoteExclusive && remote.room) setWordState({ status: "remote-grace", decisionClosesAt: wordState.decisionClosesAt!, graceEndsAt: wordState.decisionClosesAt! + JUDGE_DECISION_GRACE_MS });
      else setWordState({ status: "local-evaluation", reason: "time-up", remainingMs: 0 });
    };
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [haptics, phase, remote.room, remoteExclusive, soundEnabled, wordState]);

  useEffect(() => {
    if (phase !== "playing" || wordState.status !== "remote-grace") return;
    if (!remoteExclusive || !remote.room) {
      setWordState({ status: "local-evaluation", reason: "time-up", remainingMs: 0 });
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      const transportBudget = new Promise<void>((resolve) => window.setTimeout(resolve, FINAL_SYNC_BUDGET_MS));
      void Promise.race([remoteSyncNow(), transportBudget]).then(() => {
        const latest = wordStateRef.current;
        if (active && !processing.current && latest.status === "remote-grace" && latest.graceEndsAt === wordState.graceEndsAt) completeWord("timed_out");
      });
    }, Math.max(0, wordState.graceEndsAt - Date.now()));
    return () => { active = false; window.clearTimeout(timeout); };
  }, [completeWord, phase, remote.room, remoteExclusive, remoteSyncNow, wordState]);

  useEffect(() => () => { clearTransition(); cancelLocalSpeech(); }, [clearTransition]);

  if (phase === "builder") return <SpellingDeckBuilder deck={editingDeck} onCancel={() => setPhase("setup")} onDelete={(deck) => { deleteDeck(deck.id); setDeckId(SPELLING_DECKS[0].id); setPhase("setup"); }} onSave={(deck) => { saveDeck(deck); setDeckId(deck.id); setRoundTotal((current) => Math.min(current, deck.words.length)); setEditingDeck(deck); void startRound(customSpellingDeckAsDeck(deck)); }} />;

  if (phase === "countdown") return <GameShell tone="amber"><header className="p-5 text-black"><button type="button" onClick={() => endRound(false)} className="min-h-11 font-mono text-xs opacity-60">← cancel round</button></header><main id="main" className="flex flex-1 flex-col items-center justify-center text-center text-black"><p className="font-mono text-xs uppercase tracking-[0.2em] text-black/55">get ready to spell</p><TextMorph as="h1" className="mt-2 font-serif text-[8rem] font-semibold leading-none">{String(countdown)}</TextMorph><p className="mt-8 max-w-xs px-6 font-serif text-xl text-black/70">The word will be read aloud. The judge can ask for it again.</p></main></GameShell>;

  if (phase === "playing") return <div className="relative"><SpellingPlayArea item={item} seconds={seconds} score={score} paused={paused} presenting={presenting} awaitingRemoteDecision={wordState.status === "remote-grace"} controlsLocked={remoteExclusive && remote.room !== null} feedback={feedback} transcript={transcript} matchedCount={assistantMatch.matchedCount} mismatchAt={assistantMatch.mismatchAt} listening={assistantStatus === "listening"} followingEnabled={assistantBackend !== null} followingError={assistantStatus === "error" ? assistantMessage : null} inputLevel={assistantInputLevel} remoteBadge={<RemoteConnectionBadge connected={remote.judgeConnected} />} onReplay={(slower) => void speakWord(item, { slower })} onRetryFollowing={retryAssistant} onPause={() => setWordState((current) => ({ status: "paused", remainingMs: remainingWordMs(current) }))} onResume={() => setWordState((current) => activeWord(current.status === "paused" && current.remainingMs !== undefined ? current.remainingMs / 1_000 : timerSeconds))} onEnd={() => endRound()} onDecision={completeWord} />{evaluating && !(remoteExclusive && remote.room) ? <EvaluationModal word={item.word} transcript={transcript} reason={wordState.status === "local-evaluation" ? wordState.reason : "time-up"} onCorrect={() => completeWord("correct")} onIncorrect={() => completeWord("incorrect")} onMoreTime={() => { const extraSeconds = timerSeconds || 15; setSeconds(extraSeconds); setWordState(activeWord(extraSeconds)); }} onReplay={() => void speakWord(item)} onEnd={() => endRound()} /> : null}{endConfirmationOpen ? <EndRoundModal onCancel={() => setEndConfirmationOpen(false)} onConfirm={() => endRound(false)} /> : null}</div>;

  if (phase === "results") return <SpellingResults results={results} onBack={() => setPhase("setup")} onAgain={() => void startRound()} onAmend={(id, decision) => setResults((current) => current.map((result) => result.id === id ? { ...result, decision } : result))} />;

  if (joinedDeck) return <RemotePlayerReady gameName="Spelling Bee" deckName={joinedDeck.name} detail={`Words will be read aloud on this phone${timerSeconds ? ` with ${timerSeconds} seconds per word` : " with no timer"}.`} judgeConnected={remote.judgeConnected} onStart={() => void startRound(joinedDeck)} />;

  return <SpellingSetup decks={allDecks} selectedDeckId={deckId} customDeckIds={new Set(customDecks.map(({ id }) => id))} timerSeconds={timerSeconds} roundTotal={Math.min(roundTotal, selectedDeck.words.length)} autoSpeak={autoSpeak} soundEnabled={soundEnabled} assistantStatus={assistantStatus} assistantBackend={assistantBackend} browserSpeechAvailability={browserSpeechAvailability} assistantProgress={assistantProgress} assistantMessage={assistantMessage} downloadEstimate={downloadEstimate} remoteControls={<RemoteHostPanel gameLabel="Spelling Bee" inviteUrl={remote.inviteUrl} roomId={remote.room?.roomId ?? null} connected={remote.judgeConnected} syncing={remote.syncing} message={remote.message} exclusive={remoteExclusive} onCreate={remote.createRoom} onCreatePlayerRoom={remote.createJudgeRoom} onClose={remote.closeRoom} onMessage={remote.setMessage} onToggleExclusive={() => setRemoteExclusive((value) => !value)} />} onSelectDeck={(id) => { setDeckId(id); const deck = allDecks.find((candidate) => candidate.id === id); if (deck) setRoundTotal((current) => Math.min(current, deck.words.length)); }} onRoundTotalChange={setRoundTotal} onTimerChange={setTimerSeconds} onToggleAutoSpeak={() => setAutoSpeak((value) => !value)} onToggleSound={() => setSoundEnabled((value) => !value)} onEnableAssistant={() => void enableAssistant()} onDisableAssistant={() => void disableAssistant()} onCreateDeck={() => { setEditingDeck(null); setPhase("builder"); }} onEditDeck={(id) => { setEditingDeck(customDecks.find((deck) => deck.id === id) ?? null); setPhase("builder"); }} onStart={() => void startRound()} />;
}

function EndRoundModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="end-round-title"><div className="w-full max-w-md rounded-[2rem] bg-[var(--things-cream)] p-6 text-center text-black shadow-2xl"><p className="font-mono text-micro uppercase tracking-[0.18em] text-black/50">end round</p><h2 id="end-round-title" className="mt-3 font-serif text-4xl font-semibold">Leave this game?</h2><p className="mt-3 font-serif text-base text-black/60">Your words from this round will be cleared.</p><div className="mt-7 grid grid-cols-2 gap-3"><button type="button" autoFocus onClick={onCancel} className="min-h-14 rounded-full border border-black/20 font-mono text-sm font-semibold">keep playing</button><button type="button" onClick={onConfirm} className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white">end round</button></div></div></div>;
}

function EvaluationModal({ word, transcript, reason, onCorrect, onIncorrect, onMoreTime, onReplay, onEnd }: { word: string; transcript: string; reason: AloudEvaluationReason; onCorrect: () => void; onIncorrect: () => void; onMoreTime: () => void; onReplay: () => void; onEnd: () => void }) {
  return <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/35 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="evaluation-title"><div className="w-full max-w-md rounded-[2rem] bg-[var(--things-cream)] p-6 text-center text-black shadow-2xl"><p className="font-mono text-micro uppercase tracking-[0.18em] text-black/50">{reason === "time-up" ? "time is up" : "spelling may be complete"}</p><h1 id="evaluation-title" className="mt-3 font-serif text-4xl font-semibold">Was “{word}” spelled correctly?</h1>{transcript ? <p className="mt-3 font-mono text-sm text-black/55">heard · {transcript}</p> : <p className="mt-3 font-serif text-base text-black/55">The judge makes the final call.</p>}<div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={onIncorrect} className="min-h-14 rounded-full border border-black/20 font-mono text-sm">not correct</button><button type="button" onClick={onCorrect} className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white">correct</button></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onReplay} className="min-h-11 font-mono text-xs">say it again</button><button type="button" onClick={onMoreTime} className="min-h-11 font-mono text-xs">give more time</button></div><button type="button" onClick={onEnd} className="mt-2 min-h-11 font-mono text-xs text-black/55 underline underline-offset-4">end round</button></div></div>;
}
