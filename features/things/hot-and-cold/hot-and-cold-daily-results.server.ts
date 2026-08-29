import { isDatabaseConfigured, query } from "@/lib/platform/postgres.server";
import { HOT_AND_COLD_JUDGING_VERSION } from "./hot-and-cold-rules";
import { hotAndColdTargetForPuzzle } from "./hot-and-cold-words.server";
import type { HotAndColdCommunityStats, HotAndColdDailyResultInput } from "./types";

const MINIMUM_COMMUNITY_RUNS = 5;
const MINIMUM_STANDING_RUNS = 3;
type StoredResult = HotAndColdDailyResultInput & {
  personId: string | null;
};
const memoryResults = new Map<string, StoredResult>();

interface AggregateRow {
  puzzle: number;
  runs: string;
  solves: string;
  median_guesses: string | null;
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
      medianGuesses: row.median_guesses === null ? null : Number(row.median_guesses),
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
    if (
      !wanted.has(result.puzzle) ||
      result.judgingVersion !== HOT_AND_COLD_JUDGING_VERSION ||
      result.target !== hotAndColdTargetForPuzzle(result.puzzle)
    )
      continue;
    grouped.set(result.puzzle, [...(grouped.get(result.puzzle) ?? []), result]);
  }
  const rows: AggregateRow[] = [...grouped].map(([puzzle, stored]) => {
    const guesses = stored
      .filter(({ outcome }) => outcome === "found")
      .map(({ guesses: count }) => count)
      .sort((a, b) => a - b);
    const middle = Math.floor(guesses.length / 2);
    const median = guesses.length
      ? guesses.length % 2
        ? guesses[middle]
        : (guesses[middle - 1] + guesses[middle]) / 2
      : null;
    const total = (read: (result: HotAndColdDailyResultInput) => number) =>
      stored.reduce((sum, result) => sum + read(result), 0);
    return {
      puzzle,
      runs: String(stored.length),
      solves: String(stored.filter(({ outcome }) => outcome === "found").length),
      median_guesses: median === null ? null : String(median),
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
    if (!memoryResults.has(input.runId)) memoryResults.set(input.runId, { ...input, personId });
    return;
  }
  await query(
    `insert into hot_and_cold_daily_results
       (run_id,puzzle,target,judging_version,person_id,outcome,guesses,hints,best_rank,
        frost_guesses,cool_guesses,warm_guesses,hot_guesses)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (run_id) do nothing`,
    [
      input.runId,
      input.puzzle,
      input.target,
      input.judgingVersion,
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
       select result.*
         from hot_and_cold_daily_results result
        where puzzle = any($1::integer[])
          and judging_version = $2
          and concat(puzzle, ':', target) = any($3::text[])
     )
     select puzzle,
            count(*)::text as runs,
            count(*) filter (where outcome = 'found')::text as solves,
            percentile_cont(0.5) within group (order by guesses)
              filter (where outcome = 'found')::text as median_guesses,
            sum(frost_guesses)::text as frost,
            sum(cool_guesses)::text as cool,
            sum(warm_guesses)::text as warm,
            sum(hot_guesses)::text as hot
       from eligible
      group by puzzle`,
    [
      puzzles,
      HOT_AND_COLD_JUDGING_VERSION,
      puzzles.map((puzzle) => `${puzzle}:${hotAndColdTargetForPuzzle(puzzle)}`),
    ],
  );
  return statsFromRows(rows);
}

interface StandingRow {
  runs: string;
  better: string;
  tied: string;
  hints: number;
  median_guesses: string;
}

function standingFromStoredResults(
  puzzle: number,
  runId: string,
): Extract<HotAndColdCommunityStats, { visible: true }>["standing"] {
  const current = memoryResults.get(runId);
  if (!current || current.puzzle !== puzzle || current.outcome !== "found") return null;
  const eligible = [...memoryResults.values()].filter(
    (result) =>
      result.puzzle === puzzle &&
      result.target === current.target &&
      result.judgingVersion === current.judgingVersion &&
      result.outcome === "found" &&
      result.hints === current.hints,
  );
  if (eligible.length < MINIMUM_STANDING_RUNS) return null;
  const better = eligible.filter(({ guesses }) => guesses < current.guesses).length;
  const tied = eligible.filter(({ guesses }) => guesses === current.guesses).length;
  const guesses = eligible.map(({ guesses: count }) => count).sort((left, right) => left - right);
  const middle = Math.floor(guesses.length / 2);
  const medianGuesses =
    guesses.length % 2 ? guesses[middle] : (guesses[middle - 1] + guesses[middle]) / 2;
  const rank = better + 1;
  return {
    rank,
    runs: eligible.length,
    tied: tied > 1,
    topPercent: Math.max(1, Math.ceil((rank / eligible.length) * 100)),
    hints: current.hints,
    medianGuesses,
  };
}

export async function hotAndColdResultCommunityStats(
  puzzle: number,
  runId: string,
): Promise<HotAndColdCommunityStats | null> {
  const community = (await hotAndColdCommunityStats([puzzle])).get(puzzle) ?? null;
  if (!community?.visible) return community;
  if (!isDatabaseConfigured())
    return { ...community, standing: standingFromStoredResults(puzzle, runId) };

  const rows = await query<StandingRow>(
    `with current_run as (
       select puzzle, guesses, hints, outcome
         from hot_and_cold_daily_results
        where run_id = $2
          and puzzle = $1
          and target = $3
          and judging_version = $4
     ), eligible as (
       select result.*
         from hot_and_cold_daily_results result
        where result.puzzle = $1
          and result.target = $3
          and result.judging_version = $4
     ), cohort as (
       select eligible.guesses, current_run.hints, current_run.guesses as current_guesses
         from eligible
         cross join current_run
        where eligible.outcome = 'found'
          and current_run.outcome = 'found'
          and eligible.hints = current_run.hints
     )
     select count(*)::text as runs,
            count(*) filter (where guesses < current_guesses)::text as better,
            count(*) filter (where guesses = current_guesses)::text as tied,
            min(hints)::integer as hints,
            (percentile_cont(0.5) within group (order by guesses))::text as median_guesses
       from cohort
     having count(*) >= ${MINIMUM_STANDING_RUNS}`,
    [puzzle, runId, hotAndColdTargetForPuzzle(puzzle), HOT_AND_COLD_JUDGING_VERSION],
  );
  const row = rows[0];
  if (!row) return { ...community, standing: null };
  const runs = Number(row.runs);
  const rank = Number(row.better) + 1;
  return {
    ...community,
    standing: {
      rank,
      runs,
      tied: Number(row.tied) > 1,
      topPercent: Math.max(1, Math.ceil((rank / runs) * 100)),
      hints: row.hints,
      medianGuesses: Number(row.median_guesses),
    },
  };
}
