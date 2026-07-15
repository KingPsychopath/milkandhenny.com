export interface SpellingResult {
  id: string;
  wordId: string;
  word: string;
  decision: "correct" | "incorrect" | "skipped" | "timed_out";
  transcript?: string;
}

export function SpellingResults({ results, onBack, onAgain, onAmend }: { results: SpellingResult[]; onBack: () => void; onAgain: () => void; onAmend: (id: string, decision: SpellingResult["decision"]) => void }) {
  const score = results.filter(({ decision }) => decision === "correct").length;
  return <div className="things-game things-game--cream text-black"><header className="flex items-center justify-between p-5 font-mono text-xs text-black/55"><button type="button" onClick={onBack} className="min-h-11">← decks</button><span>round complete</span></header><main id="main" className="mx-auto w-full max-w-lg flex-1 px-6 pb-10 text-center"><p className="mt-8 font-mono text-micro uppercase tracking-[0.2em] text-black/50">correctly spelled</p><h1 className="mt-2 font-serif text-8xl font-semibold leading-none">{score}</h1><button type="button" onClick={onAgain} className="mt-7 min-h-14 w-full rounded-full bg-black font-mono text-sm font-semibold text-white">another round</button><section className="mt-10 text-left" aria-labelledby="spelling-results"><h2 id="spelling-results" className="font-mono text-micro uppercase tracking-[0.18em] text-black/50">the words · tap to correct</h2><ul className="mt-3 border-t border-black/15">{results.map((result) => <li key={result.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-black/15 py-3"><span className="font-serif text-lg">{result.word}</span><select aria-label={`Change result for ${result.word}`} value={result.decision} onChange={(event) => onAmend(result.id, event.target.value as SpellingResult["decision"])} className="min-h-11 rounded-full border border-black/15 bg-transparent px-3 font-mono text-xs"><option value="correct">correct</option><option value="incorrect">incorrect</option><option value="skipped">skipped</option><option value="timed_out">timed out</option></select></li>)}</ul></section></main></div>;
}
