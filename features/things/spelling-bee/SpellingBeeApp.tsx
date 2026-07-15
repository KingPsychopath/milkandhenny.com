import { useCallback, useEffect, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { playGameSound, primeGameAudio } from "../heads-up/gameSound";
import { RemoteConnectionBadge, RemoteHostPanel } from "../remote/RemoteHostPanel";
import { useRemoteGameHost } from "../remote/useRemoteGameHost";
import type { RemoteCommand, RemoteGameSnapshot } from "../remote/types";
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

type Phase = "setup" | "builder" | "countdown" | "playing" | "results";
type Decision = "correct" | "incorrect";
const ROUND_STORAGE_KEY = "spelling-bee:active-round:v1";

export function SpellingBeeApp() {
  const fullscreen = useFullscreen();
  return <div ref={fullscreen.targetRef} className="things-game-fullscreen"><SpellingBeeExperience /></div>;
}

function SpellingBeeExperience() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [deckId, setDeckId] = useState(SPELLING_DECKS[0].id);
  const [words, setWords] = useState(() => shuffledWords(SPELLING_DECKS[0].words));
  const [wordIndex, setWordIndex] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [seconds, setSeconds] = useState<number | null>(30);
  const [results, setResults] = useState<SpellingResult[]>([]);
  const [feedback, setFeedback] = useState<Decision | null>(null);
  const [paused, setPaused] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [remoteExclusive, setRemoteExclusive] = useState(false);
  const [editingDeck, setEditingDeck] = useState<CustomSpellingDeck | null>(null);
  const processing = useRef(false);
  const transitionTimeout = useRef<number | null>(null);
  const restoredRound = useRef(false);
  const haptics = useWebHaptics();
  const {
    status: assistantStatus,
    backend: assistantBackend,
    browserAvailability: browserSpeechAvailability,
    progress: assistantProgress,
    match: assistantMatch,
    message: assistantMessage,
    downloadEstimate,
    enable: enableAssistant,
    disable: disableAssistant,
    start: startAssistant,
    stop: stopAssistant,
  } = useLocalSpellingAssistant();
  const transcript = assistantMatch.letters;
  const { customDecks, saveDeck, deleteDeck } = useCustomSpellingDecks();
  const allDecks = [...SPELLING_DECKS, ...customDecks.map(customSpellingDeckAsDeck)];
  const selectedDeck = allDecks.find(({ id }) => id === deckId) ?? SPELLING_DECKS[0];
  const item = words[wordIndex] ?? selectedDeck.words[0];
  const score = results.filter(({ decision }) => decision === "correct").length;

  const clearTransition = useCallback(() => {
    if (transitionTimeout.current === null) return;
    window.clearTimeout(transitionTimeout.current);
    transitionTimeout.current = null;
  }, []);

  const completeWord = useCallback((decision: Decision) => {
    if (phase !== "playing" || processing.current || (paused && !evaluating) || presenting) return;
    processing.current = true;
    stopAssistant();
    setEvaluating(false);
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
      setPaused(false);
      processing.current = false;
      transitionTimeout.current = null;
    }, 420);
  }, [evaluating, haptics, item.id, item.word, paused, phase, presenting, soundEnabled, stopAssistant, transcript, wordIndex, words.length]);

  const undoDecision = useCallback(() => {
    if (phase !== "playing" || results.length === 0) return;
    clearTransition();
    setResults((current) => current.slice(0, -1));
    setWordIndex((current) => Math.max(0, current - 1));
    setFeedback(null);
    setPaused(false);
    setEvaluating(false);
    processing.current = false;
  }, [clearTransition, phase, results.length]);

  const handleRemoteCommand = useCallback((command: RemoteCommand) => {
    if (command.type === "correct") return completeWord("correct");
    if (command.type === "incorrect" || command.type === "pass") return completeWord("incorrect");
    if (command.type === "pause") return setPaused(true);
    if (command.type === "resume") { setPaused(false); setEvaluating(false); return; }
    if (command.type === "undo") return undoDecision();
    if (command.type !== "amend") return;
    setResults((current) => current.map((result) => result.id === command.resultId ? { ...result, decision: command.decision } : result));
  }, [completeWord, undoDecision]);

  const { requestAccess, calibrate } = useTiltControl(
    phase === "playing" && !feedback && !paused && !presenting && !remoteExclusive,
    (decision) => completeWord(decision === "correct" ? "correct" : "incorrect"),
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
    paused,
    pauseReason: evaluating ? "time is up" : paused ? "paused" : undefined,
    score,
    results: results.map((result) => ({ id: result.id, label: result.word, decision: result.decision })),
    transcript: transcript || undefined,
    updatedAt: Date.now(),
  };
  const remote = useRemoteGameHost("spelling-bee", remoteSnapshot, handleRemoteCommand);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(ROUND_STORAGE_KEY) ?? "null");
      if (!stored || typeof stored !== "object") return;
      const value = stored as { phase?: Phase; deckId?: string; words?: unknown; wordIndex?: number; seconds?: number | null; results?: unknown; timerSeconds?: number; savedAt?: number };
      if (!value.savedAt || Date.now() - value.savedAt > 2 * 60 * 60 * 1000) return;
      if (!Array.isArray(value.words) || !value.words.every((entry) => entry && typeof entry === "object" && typeof (entry as { word?: unknown }).word === "string")) return;
      if (!Array.isArray(value.results)) return;
      const restoredResults = value.results.filter((result): result is SpellingResult => {
        if (!result || typeof result !== "object") return false;
        const entry = result as Partial<SpellingResult>;
        return typeof entry.id === "string" && typeof entry.wordId === "string" && typeof entry.word === "string" && (entry.decision === "correct" || entry.decision === "incorrect" || entry.decision === "pass");
      });
      if (value.phase !== "playing" && value.phase !== "countdown" && value.phase !== "results") return;
      setDeckId(typeof value.deckId === "string" ? value.deckId : SPELLING_DECKS[0].id);
      setWords(value.words as typeof words);
      setWordIndex(typeof value.wordIndex === "number" ? Math.max(0, Math.min(value.wordIndex, value.words.length - 1)) : 0);
      setSeconds(typeof value.seconds === "number" ? Math.max(0, value.seconds) : null);
      setTimerSeconds(typeof value.timerSeconds === "number" ? value.timerSeconds : 30);
      setResults(restoredResults);
      setPhase(value.phase === "countdown" ? "playing" : value.phase);
      if (value.phase !== "results") setPaused(true);
      restoredRound.current = true;
    } catch {
      sessionStorage.removeItem(ROUND_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (phase === "setup" || phase === "builder") {
      if (restoredRound.current) sessionStorage.removeItem(ROUND_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(ROUND_STORAGE_KEY, JSON.stringify({ phase, deckId, words, wordIndex, seconds, results, timerSeconds, savedAt: Date.now() }));
    restoredRound.current = true;
  }, [deckId, phase, results, seconds, timerSeconds, wordIndex, words]);

  const startRound = useCallback(async (deck: SpellingDeck = selectedDeck) => {
    primeGameAudio();
    stopAssistant();
    cancelLocalSpeech();
    setWords(shuffledWords(deck.words));
    setWordIndex(0);
    setResults([]);
    setFeedback(null);
    setPaused(false);
    setEvaluating(false);
    setCountdown(3);
    setSeconds(timerSeconds || null);
    processing.current = false;
    clearTransition();
    await requestAccess();
    void haptics.trigger("medium");
    setPhase("countdown");
  }, [clearTransition, haptics, requestAccess, selectedDeck, stopAssistant, timerSeconds]);

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
    if (phase !== "playing" || paused) return;
    setSeconds(timerSeconds || null);
    setEvaluating(false);
    setPaused(false);
    if (!autoSpeak) { setPresenting(false); return; }
    let active = true;
    setPresenting(true);
    void speakWord(item).finally(() => { if (active) setPresenting(false); });
    return () => { active = false; cancelLocalSpeech(); };
  }, [autoSpeak, item, paused, phase, timerSeconds]);

  useEffect(() => {
    if (phase !== "playing" || presenting || feedback || paused || assistantStatus !== "ready") return;
    void startAssistant(item.word);
  }, [assistantStatus, feedback, item.word, paused, phase, presenting, startAssistant]);

  useEffect(() => {
    if (phase !== "playing" || !assistantMatch.complete || evaluating) return;
    stopAssistant();
    setPaused(true);
    setEvaluating(true);
    void haptics.trigger("selection");
  }, [assistantMatch.complete, evaluating, haptics, phase, stopAssistant]);

  useEffect(() => {
    if (phase !== "playing" || seconds === null || paused || presenting || feedback) return;
    if (seconds <= 0) {
      setPaused(true);
      setEvaluating(true);
      playGameSound("end", soundEnabled);
      void haptics.trigger("heavy");
      return;
    }
    const timeout = window.setTimeout(() => setSeconds((current) => current === null ? null : Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timeout);
  }, [feedback, haptics, paused, phase, presenting, seconds, soundEnabled]);

  useEffect(() => () => { clearTransition(); cancelLocalSpeech(); }, [clearTransition]);

  if (phase === "builder") return <SpellingDeckBuilder deck={editingDeck} onCancel={() => setPhase("setup")} onDelete={(deck) => { if (!confirm(`Delete “${deck.name}”?`)) return; deleteDeck(deck.id); setDeckId(SPELLING_DECKS[0].id); setPhase("setup"); }} onSave={(deck) => { saveDeck(deck); setDeckId(deck.id); setEditingDeck(deck); void startRound(customSpellingDeckAsDeck(deck)); }} />;

  if (phase === "countdown") return <GameShell tone="amber"><main id="main" className="flex flex-1 flex-col items-center justify-center text-center text-black"><p className="font-mono text-xs uppercase tracking-[0.2em] text-black/55">get ready to spell</p><TextMorph as="h1" className="mt-2 font-serif text-[8rem] font-semibold leading-none">{String(countdown)}</TextMorph><p className="mt-8 max-w-xs px-6 font-serif text-xl text-black/70">The word will be read aloud. The judge can ask for it again.</p></main></GameShell>;

  if (phase === "playing") return <div className="relative"><SpellingPlayArea item={item} seconds={seconds} score={score} paused={paused && !evaluating} presenting={presenting} controlsLocked={remoteExclusive && remote.room !== null} feedback={feedback} transcript={transcript} matchedCount={assistantMatch.matchedCount} mismatchAt={assistantMatch.mismatchAt} listening={assistantStatus === "listening"} remoteBadge={<RemoteConnectionBadge connected={remote.judgeConnected} />} onReplay={(slower) => void speakWord(item, { slower })} onPause={() => setPaused(true)} onResume={() => setPaused(false)} onDecision={completeWord} />{evaluating ? <EvaluationModal word={item.word} transcript={transcript} onCorrect={() => completeWord("correct")} onIncorrect={() => completeWord("incorrect")} onMoreTime={() => { setSeconds(timerSeconds || 15); setEvaluating(false); setPaused(false); }} onReplay={() => void speakWord(item)} /> : null}</div>;

  if (phase === "results") return <SpellingResults results={results} onBack={() => setPhase("setup")} onAgain={() => void startRound()} onAmend={(id, decision) => setResults((current) => current.map((result) => result.id === id ? { ...result, decision } : result))} />;

  return <SpellingSetup decks={allDecks} selectedDeckId={deckId} customDeckIds={new Set(customDecks.map(({ id }) => id))} timerSeconds={timerSeconds} autoSpeak={autoSpeak} soundEnabled={soundEnabled} assistantStatus={assistantStatus} assistantBackend={assistantBackend} browserSpeechAvailability={browserSpeechAvailability} assistantProgress={assistantProgress} assistantMessage={assistantMessage} downloadEstimate={downloadEstimate} remoteControls={<RemoteHostPanel gameLabel="Spelling Bee" inviteUrl={remote.inviteUrl} roomId={remote.room?.roomId ?? null} connected={remote.judgeConnected} syncing={remote.syncing} message={remote.message} exclusive={remoteExclusive} onCreate={remote.createRoom} onClose={remote.closeRoom} onMessage={remote.setMessage} onToggleExclusive={() => setRemoteExclusive((value) => !value)} />} onSelectDeck={setDeckId} onTimerChange={setTimerSeconds} onToggleAutoSpeak={() => setAutoSpeak((value) => !value)} onToggleSound={() => setSoundEnabled((value) => !value)} onEnableAssistant={() => void enableAssistant()} onDisableAssistant={() => void disableAssistant()} onCreateDeck={() => { setEditingDeck(null); setPhase("builder"); }} onEditDeck={(id) => { setEditingDeck(customDecks.find((deck) => deck.id === id) ?? null); setPhase("builder"); }} onStart={() => void startRound()} />;
}

function EvaluationModal({ word, transcript, onCorrect, onIncorrect, onMoreTime, onReplay }: { word: string; transcript: string; onCorrect: () => void; onIncorrect: () => void; onMoreTime: () => void; onReplay: () => void }) {
  return <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/35 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="evaluation-title"><div className="w-full max-w-md rounded-[2rem] bg-[var(--things-cream)] p-6 text-center text-black shadow-2xl"><p className="font-mono text-micro uppercase tracking-[0.18em] text-black/50">time is up</p><h1 id="evaluation-title" className="mt-3 font-serif text-4xl font-semibold">Was “{word}” complete?</h1>{transcript ? <p className="mt-3 font-mono text-sm text-black/55">heard · {transcript}</p> : <p className="mt-3 font-serif text-base text-black/55">The judge makes the final call.</p>}<div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={onIncorrect} className="min-h-14 rounded-full border border-black/20 font-mono text-sm">incorrect</button><button type="button" onClick={onCorrect} className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white">correct</button></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onReplay} className="min-h-11 font-mono text-xs">say it again</button><button type="button" onClick={onMoreTime} className="min-h-11 font-mono text-xs">give more time</button></div></div></div>;
}
