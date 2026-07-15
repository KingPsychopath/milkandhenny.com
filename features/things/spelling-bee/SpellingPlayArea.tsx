import type { ReactNode } from "react";
import type { SpellingWord } from "./decks";

export function SpellingPlayArea({
  item,
  seconds,
  score,
  paused,
  presenting,
  controlsLocked,
  feedback,
  transcript,
  matchedCount,
  mismatchAt,
  listening,
  remoteBadge,
  onReplay,
  onPause,
  onResume,
  onDecision,
}: {
  item: SpellingWord;
  seconds: number | null;
  score: number;
  paused: boolean;
  presenting: boolean;
  controlsLocked: boolean;
  feedback: "correct" | "incorrect" | null;
  transcript: string;
  matchedCount: number;
  mismatchAt: number | null;
  listening: boolean;
  remoteBadge: ReactNode;
  onReplay: (slower?: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onDecision: (decision: "correct" | "incorrect") => void;
}) {
  return (
    <div className={`things-game ${feedback === "correct" ? "things-game--green" : feedback === "incorrect" ? "things-game--stone" : "things-game--amber"} text-black`}>
      <header className="grid grid-cols-3 items-center px-5 py-4">
        <span>{remoteBadge}</span><span className="justify-self-center rounded-full border border-black/15 px-4 py-2 font-mono text-lg font-semibold tabular-nums">{seconds === null ? "∞" : seconds}</span><span className="justify-self-end font-mono text-xs opacity-60">{score} correct</span>
      </header>
      <main id="main" className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center">
        {paused ? <div role="alert"><p className="font-mono text-micro uppercase tracking-[0.2em] text-black/50">word paused</p><h1 className="mt-4 font-serif text-5xl font-semibold">Take a breath.</h1><button type="button" onClick={onResume} className="mt-7 min-h-12 rounded-full bg-black px-6 font-mono text-sm font-semibold text-white">resume</button></div> : <>
          <p className="font-mono text-micro uppercase tracking-[0.2em] text-black/45">{presenting ? "listen" : feedback ? feedback : "spell this"}</p>
          <HighlightedWord word={item.word} matchedCount={matchedCount} mismatchAt={mismatchAt} listening={listening} />
          {item.definition || item.partOfSpeech ? <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed text-black/60">{item.partOfSpeech ? <em>{item.partOfSpeech}</em> : null}{item.partOfSpeech && item.definition ? " · " : null}{item.definition}</p> : null}
          {transcript ? <p className="mt-5 font-mono text-sm tracking-[0.14em] text-black/65">heard · {transcript}</p> : null}
          <div className="mt-8 flex flex-wrap justify-center gap-2"><button type="button" onClick={() => onReplay()} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">↻ say it again</button><button type="button" onClick={() => onReplay(true)} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">say it slowly</button><button type="button" onClick={onPause} className="min-h-11 rounded-full border border-black/20 px-4 font-mono text-xs">pause</button></div>
        </>}
      </main>
      <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button type="button" disabled={paused || presenting || controlsLocked} onClick={() => onDecision("incorrect")} className="min-h-14 rounded-full border border-black/20 bg-black/5 font-mono text-sm font-semibold disabled:opacity-35">↑ incorrect / skip</button><button type="button" disabled={paused || presenting || controlsLocked} onClick={() => onDecision("correct")} className="min-h-14 rounded-full bg-black font-mono text-sm font-semibold text-white disabled:opacity-35">correct ↓</button></footer>
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
