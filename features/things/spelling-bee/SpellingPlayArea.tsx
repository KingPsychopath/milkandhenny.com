import type { ReactNode } from "react";
import type { SpellingWord } from "./decks";

export function SpellingPlayArea({
  item,
  seconds,
  score,
  paused,
  presenting,
  awaitingRemoteDecision,
  controlsLocked,
  feedback,
  transcript,
  matchedCount,
  mismatchAt,
  listening,
  followingEnabled,
  followingError,
  inputLevel,
  remoteBadge,
  onReplay,
  onRetryFollowing,
  onPause,
  onResume,
  onEnd,
  onDecision,
}: {
  item: SpellingWord;
  seconds: number | null;
  score: number;
  paused: boolean;
  presenting: boolean;
  awaitingRemoteDecision: boolean;
  controlsLocked: boolean;
  feedback: "correct" | "incorrect" | "skipped" | "timed_out" | null;
  transcript: string;
  matchedCount: number;
  mismatchAt: number | null;
  listening: boolean;
  followingEnabled: boolean;
  followingError: string | null;
  inputLevel: number;
  remoteBadge: ReactNode;
  onReplay: (slower?: boolean) => void;
  onRetryFollowing: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onDecision: (decision: "correct" | "incorrect" | "skipped") => void;
}) {
  return (
    <div className={`things-game ${feedback === "correct" ? "things-game--green" : feedback ? "things-game--stone" : "things-game--amber"} text-black`}>
      <header className="grid grid-cols-3 items-center px-5 py-4">
        <span className="flex items-center gap-3"><button type="button" onClick={onEnd} className="min-h-11 rounded-full border border-black/20 px-3 font-mono text-xs">end round</button>{remoteBadge}</span><span className="justify-self-center rounded-full border border-black/15 px-4 py-2 font-mono text-lg font-semibold tabular-nums">{seconds === null ? "∞" : seconds}</span><span className="justify-self-end font-mono text-xs opacity-60">{score} correct</span>
      </header>
      <main id="main" className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
        {paused ? <div role="alert"><p className="font-mono text-micro uppercase tracking-[0.2em] text-black/50">word paused · timer stopped</p><h1 className="mt-4 font-serif text-5xl font-semibold">Take a breath.</h1><div className="mt-7 flex flex-col items-center gap-2"><button type="button" onClick={onResume} className="min-h-12 rounded-full bg-black px-6 font-mono text-sm font-semibold text-white">resume with {seconds === null ? "no timer" : `${seconds}s left`}</button><button type="button" onClick={onEnd} className="min-h-11 px-4 font-mono text-xs text-black/55 underline underline-offset-4">end round</button></div></div> : <>
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/45">{presenting ? "listen" : awaitingRemoteDecision ? "time’s up · checking judge" : feedback === "timed_out" ? "timed out" : feedback ?? "spell this"}</p>
          <HighlightedWord word={item.word} matchedCount={matchedCount} mismatchAt={mismatchAt} listening={listening} />
          {item.definition || item.partOfSpeech ? <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-black/60">{item.partOfSpeech ? <em>{item.partOfSpeech}</em> : null}{item.partOfSpeech && item.definition ? " · " : null}{item.definition}</p> : null}
          {followingEnabled ? (
            <div className="mt-5 flex min-h-11 flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-micro text-black/55" role="status" aria-label={listening ? "Microphone on and listening" : followingError ?? "Spelling follower ready"}>
              <span aria-hidden="true" className={listening ? "text-emerald-800" : "text-black/35"}>●</span>
              <span>{listening ? (inputLevel > 0.08 ? "hearing you" : "mic on · listening") : followingError ? "following stopped" : "following ready"}</span>
              {listening ? <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-black/10"><span className="block h-full origin-left rounded-full bg-emerald-800 transition-transform duration-75" style={{ transform: `scaleX(${Math.max(0.06, inputLevel)})` }} /></span> : null}
              {followingError ? <button type="button" onClick={onRetryFollowing} className="min-h-11 px-2 font-mono text-micro underline underline-offset-4">try again</button> : null}
            </div>
          ) : null}
          {transcript ? <p className="mt-5 font-mono text-sm tracking-[0.14em] text-black/65">heard · {transcript}</p> : null}
          <div className="mt-8 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => onReplay()} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">↻ say it again</button><button type="button" onClick={() => onReplay(true)} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">say it slowly</button><button type="button" onClick={onPause} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">pause</button></div>
        </>}
      </main>
      <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button type="button" disabled={paused || presenting || controlsLocked} onClick={() => onDecision("incorrect")} className="min-h-14 rounded-full border border-black/20 bg-black/5 font-mono text-sm font-semibold disabled:opacity-35">incorrect</button><button type="button" disabled={paused || presenting || controlsLocked} onClick={() => onDecision("correct")} className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white disabled:opacity-35">correct ↓</button><button type="button" disabled={paused || presenting || controlsLocked} onClick={() => onDecision("skipped")} className="col-span-2 min-h-11 rounded-full font-mono text-xs text-black/55 underline underline-offset-4 disabled:opacity-35">skip this word ↑</button></footer>
    </div>
  );
}

function HighlightedWord({ word, matchedCount, mismatchAt, listening }: { word: string; matchedCount: number; mismatchAt: number | null; listening: boolean }) {
  let letterIndex = 0;
  return (
    <h1 aria-label={word} className="mt-4 max-w-3xl break-words font-serif text-5xl font-semibold leading-none tracking-tight sm:text-7xl">
      {Array.from(word).map((character, index) => {
        if (!/[a-z]/i.test(character)) return <span key={`${character}-${index}`}>{character}</span>;
        const position = letterIndex++;
        const matched = position < matchedCount;
        const mismatch = mismatchAt === position;
        const current = listening && mismatchAt === null && position === matchedCount;
        return (
          <span
            key={`${character}-${index}`}
            aria-hidden="true"
            className={`inline-block px-[0.015em] underline decoration-[0.07em] underline-offset-[0.12em] transition-colors duration-150 ${matched ? "decoration-emerald-700" : mismatch ? "bg-red-700/10 decoration-red-700" : current ? "bg-white/30 decoration-black/35" : "decoration-transparent"}`}
          >
            {character}
          </span>
        );
      })}
    </h1>
  );
}
