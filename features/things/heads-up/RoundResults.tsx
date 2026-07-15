export interface RoundResult {
  id: string;
  card: string;
  decision: "correct" | "pass";
}

interface RoundResultsProps {
  results: RoundResult[];
  score: number;
  onBack: () => void;
  onPlayAgain: () => void;
}

export function RoundResults({ results, score, onBack, onPlayAgain }: RoundResultsProps) {
  return (
    <div className="things-game things-game--cream">
      <header className="flex items-center justify-between p-5 font-mono text-xs text-black/55">
        <button type="button" onClick={onBack} className="min-h-11">
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
            onClick={onPlayAgain}
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
            {results.map((result) => (
              <li
                key={result.id}
                className="flex min-w-0 items-center justify-between gap-4 border-b border-black/15 py-3"
              >
                <span className="min-w-0 break-words font-serif text-lg [overflow-wrap:anywhere]">
                  {result.card}
                </span>
                <span className="shrink-0 font-mono text-xs text-black/50">
                  {result.decision === "correct" ? "correct ✓" : "passed ↑"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
