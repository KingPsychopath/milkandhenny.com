import type { PollResult } from "../types";

function relativePreference(weight: number): string {
  if (weight <= 0) return "no preference yet";
  if (weight >= 0.95) return "one of the strongest preferences";
  if (weight >= 0.65) return "a strong preference";
  if (weight >= 0.35) return "some preference";
  return "a lighter preference";
}

export function PollDistribution({
  results,
  showPercentages,
  showCounts = false,
}: {
  results: readonly PollResult[];
  showPercentages: boolean;
  showCounts?: boolean;
}) {
  const hasVotes = results.some((result) => result.votes > 0);
  return (
    <div>
      <div
        className="grid h-56 items-end gap-2 border-b theme-border-strong sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}
        aria-label="Poll result distribution"
      >
        {results.map((result) => {
          const height = hasVotes ? 10 + result.weight * 90 : 10;
          const detail = showCounts
            ? `${result.votes} ${result.votes === 1 ? "vote" : "votes"}`
            : showPercentages
              ? `${Math.round(result.percentage)}%`
              : relativePreference(result.weight);
          return (
            <div
              key={result.id}
              className="relative h-full"
              role="img"
              aria-label={`${result.label}: ${detail}`}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-[1.25rem] border border-b-0 theme-border-strong bg-[var(--stone-100)] transition-[height] duration-500"
                style={{ height: `${height}%` }}
              >
                {showPercentages || showCounts ? (
                  <span className="absolute inset-x-0 top-3 text-center font-mono text-micro font-bold">
                    {showCounts ? result.votes : `${Math.round(result.percentage)}%`}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="mt-3 grid gap-2 sm:gap-3"
        style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {results.map((result) => (
          <span
            key={result.id}
            className="text-center font-mono text-[0.62rem] leading-tight theme-muted sm:text-xs"
          >
            {result.label}
          </span>
        ))}
      </div>
    </div>
  );
}
