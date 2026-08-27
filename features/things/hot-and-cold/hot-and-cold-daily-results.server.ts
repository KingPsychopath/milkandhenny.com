import { isDatabaseConfigured, query } from "@/lib/platform/postgres.server";
import type { HotAndColdCommunityStats, HotAndColdDailyResultInput } from "./types";

const MINIMUM_COMMUNITY_RUNS = 5;
function seededResult(
  runId: string,
  puzzle: number,
  outcome: "found" | "revealed",
  guesses: number,
  hints: number,
  bestRank: number,
  [frost, cool, warm, hot]: [number, number, number, number],
): HotAndColdDailyResultInput {
  return {
    runId,
    puzzle,
    outcome,
    guesses,
    hints,
    bestRank,
    distribution: { frost, cool, warm, hot },
  };
}
const SEEDED_RESULTS = [
  seededResult("00000000-0000-4000-8000-000000000101", 1, "found", 8, 0, 0, [2, 1, 2, 2]),
  seededResult("00000000-0000-4000-8000-000000000102", 1, "found", 12, 1, 0, [5, 2, 2, 2]),
  seededResult("00000000-0000-4000-8000-000000000103", 1, "found", 16, 0, 0, [7, 3, 3, 2]),
  seededResult("00000000-0000-4000-8000-000000000104", 1, "found", 22, 2, 0, [10, 5, 3, 3]),
  seededResult("00000000-0000-4000-8000-000000000105", 1, "revealed", 31, 3, 18, [18, 7, 4, 2]),
  seededResult("00000000-0000-4000-8000-000000000201", 2, "found", 6, 0, 0, [1, 1, 1, 2]),
  seededResult("00000000-0000-4000-8000-000000000202", 2, "found", 10, 0, 0, [3, 2, 2, 2]),
  seededResult("00000000-0000-4000-8000-000000000203", 2, "found", 14, 1, 0, [5, 3, 3, 2]),
  seededResult("00000000-0000-4000-8000-000000000204", 2, "found", 19, 2, 0, [8, 4, 3, 3]),
  seededResult("00000000-0000-4000-8000-000000000205", 2, "revealed", 27, 3, 42, [15, 6, 4, 2]),
];
type StoredResult = HotAndColdDailyResultInput & {
  personId: string | null;
  synthetic: boolean;
};
const memoryResults = new Map<string, StoredResult>(
  SEEDED_RESULTS.map((result) => [result.runId, { ...result, personId: null, synthetic: true }]),
);

interface AggregateRow {
  puzzle: number;
  runs: string;
  solves: string;
  average_guesses: string;
  median_guesses: string;
  average_hints: string;
  frost: string;
  cool: string;
  warm: string;
  hot: string;
}

function statsFromRows(rows: AggregateRow[]): Map<number, HotAndColdCommunityStats> {
  const stats = new Map<number, HotAndColdCommunityStats>();
  for (const row of rows) {
    const runs = Number(row.runs);
    if (runs < MINIMUM_COMMUNITY_RUNS) {
      stats.set(row.puzzle, { runs, visible: false });
      continue;
    }
    const solves = Number(row.solves);
    stats.set(row.puzzle, {
      runs,
      visible: true,
      solveRate: runs ? solves / runs : 0,
      averageGuesses: Number(row.average_guesses),
      medianGuesses: Number(row.median_guesses),
      averageHints: Number(row.average_hints),
      distribution: {
        frost: Number(row.frost),
        cool: Number(row.cool),
        warm: Number(row.warm),
        hot: Number(row.hot),
      },
    });
  }
  return stats;
}

function aggregateMemory(puzzles: readonly number[]): Map<number, HotAndColdCommunityStats> {
  const wanted = new Set(puzzles);
  const grouped = new Map<number, StoredResult[]>();
  for (const result of memoryResults.values()) {
    if (!wanted.has(result.puzzle)) continue;
    grouped.set(result.puzzle, [...(grouped.get(result.puzzle) ?? []), result]);
  }
  const rows: AggregateRow[] = [...grouped].map(([puzzle, stored]) => {
    const real = stored.filter(({ synthetic }) => !synthetic);
    const results = real.length >= MINIMUM_COMMUNITY_RUNS ? real : stored;
    const guesses = results.map(({ guesses: count }) => count).sort((a, b) => a - b);
    const middle = Math.floor(guesses.length / 2);
    const median =
      guesses.length % 2 ? guesses[middle] : (guesses[middle - 1] + guesses[middle]) / 2;
    const total = (read: (result: HotAndColdDailyResultInput) => number) =>
      results.reduce((sum, result) => sum + read(result), 0);
    return {
      puzzle,
      runs: String(results.length),
      solves: String(results.filter(({ outcome }) => outcome === "found").length),
      average_guesses: String(total(({ guesses: count }) => count) / results.length),
      median_guesses: String(median),
      average_hints: String(total(({ hints }) => hints) / results.length),
      frost: String(total(({ distribution }) => distribution.frost)),
      cool: String(total(({ distribution }) => distribution.cool)),
      warm: String(total(({ distribution }) => distribution.warm)),
      hot: String(total(({ distribution }) => distribution.hot)),
    };
  });
  return statsFromRows(rows);
}

export async function recordHotAndColdDailyResult(
  input: HotAndColdDailyResultInput,
  personId: string | null,
): Promise<void> {
  if (!isDatabaseConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Result persistence unavailable");
    if (!memoryResults.has(input.runId))
      memoryResults.set(input.runId, { ...input, personId, synthetic: false });
    return;
  }
  await query(
    `insert into hot_and_cold_daily_results
       (run_id,puzzle,person_id,outcome,guesses,hints,best_rank,frost_guesses,
        cool_guesses,warm_guesses,hot_guesses)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (run_id) do nothing`,
    [
      input.runId,
      input.puzzle,
      personId,
      input.outcome,
      input.guesses,
      input.hints,
      input.bestRank,
      input.distribution.frost,
      input.distribution.cool,
      input.distribution.warm,
      input.distribution.hot,
    ],
  );
}

export async function hotAndColdCommunityStats(
  puzzles: readonly number[],
): Promise<Map<number, HotAndColdCommunityStats>> {
  if (puzzles.length === 0) return new Map();
  if (!isDatabaseConfigured()) return aggregateMemory(puzzles);
  const rows = await query<AggregateRow>(
    `with eligible as (
       select result.*,
              count(*) filter (where not synthetic) over (partition by puzzle) as real_runs
         from hot_and_cold_daily_results result
        where puzzle = any($1::integer[])
     )
     select puzzle,
            count(*)::text as runs,
            count(*) filter (where outcome = 'found')::text as solves,
            avg(guesses)::text as average_guesses,
            percentile_cont(0.5) within group (order by guesses)::text as median_guesses,
            avg(hints)::text as average_hints,
            sum(frost_guesses)::text as frost,
            sum(cool_guesses)::text as cool,
            sum(warm_guesses)::text as warm,
            sum(hot_guesses)::text as hot
       from eligible
      where real_runs < ${MINIMUM_COMMUNITY_RUNS} or not synthetic
      group by puzzle`,
    [puzzles],
  );
  return statsFromRows(rows);
}
