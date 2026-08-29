import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { recordPersonGame } from "@/features/person-games/history.server";
import { log } from "@/lib/platform/logger.server";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";
import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
} from "../shared/multiplayer-validation";
import {
  applyHotAndColdAction,
  createHotAndColdRoom,
  joinHotAndColdRoom,
  readHotAndColdSnapshot,
} from "./hot-and-cold-room.server";
import { heatBand, HOT_AND_COLD_JUDGING_VERSION, prepareGuess } from "./hot-and-cold-rules";
import { hotAndColdHint } from "./hot-and-cold-lexicon.server";
import { HotAndColdInvalidGuessError, scoreHotAndColdGuess } from "./hot-and-cold-scorer.server";
import {
  hotAndColdPuzzleDate,
  hotAndColdPuzzleNumber,
  hotAndColdTargetForPuzzle,
  previousHotAndColdPuzzles,
} from "./hot-and-cold-words.server";
import {
  hotAndColdCommunityStats,
  hotAndColdResultCommunityStats,
  recordHotAndColdDailyResult,
} from "./hot-and-cold-daily-results.server";
import type {
  HotAndColdAction,
  HotAndColdCommunityStats,
  HotAndColdDailyResultInput,
  HotAndColdSnapshot,
} from "./types";

const record = multiplayerRecord;
const integer = (value: unknown) => multiplayerSequence(value);

function playablePuzzle(value: unknown): number {
  const puzzle = integer(value);
  if (puzzle < 1 || puzzle > hotAndColdPuzzleNumber()) throw new Error("Puzzle not found");
  return puzzle;
}

function currentJudgingVersion(value: unknown) {
  if (value !== HOT_AND_COLD_JUDGING_VERSION)
    throw new Error("The judging revision changed — reload this game");
  return HOT_AND_COLD_JUDGING_VERSION;
}

function dailyHistoryReference(puzzle: number) {
  return `${puzzle}@${HOT_AND_COLD_JUDGING_VERSION}`;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  const parsed = integer(value);
  if (parsed < minimum || parsed > maximum) throw new Error("Invalid result summary");
  return parsed;
}

async function recordHistory(
  operation: string,
  context: Record<string, string | number> = {},
  task: () => Promise<void>,
): Promise<void> {
  try {
    await task();
  } catch (error) {
    log.warn("things.hot-and-cold", "Could not record optional game history", {
      operation,
      ...context,
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
}

async function currentPersonId(): Promise<string | null> {
  return (await getAttendeeSession())?.personId ?? null;
}

async function recordRoomSnapshot(input: {
  snapshot: HotAndColdSnapshot;
  event?: { key: string; kind: string; payload?: Record<string, string | number | boolean | null> };
  abandoned?: boolean;
}): Promise<void> {
  await recordHistory("room_snapshot", {}, async () => {
    const personId = await currentPersonId();
    if (!personId) return;
    const player = input.snapshot.players.find(({ id }) => id === input.snapshot.playerId);
    if (!player) return;
    const completed = input.snapshot.phase === "finished";
    await recordPersonGame({
      personId,
      game: "hot-and-cold",
      mode: "room",
      externalRef: `${input.snapshot.roomId}:${input.snapshot.gameNumber}`,
      displayName: player.name,
      status: completed ? "completed" : input.abandoned ? "abandoned" : "active",
      outcome: completed
        ? input.snapshot.winnerIds.includes(player.id)
          ? "won"
          : "completed"
        : input.abandoned
          ? "left"
          : undefined,
      score: player.score,
      summary: {
        rounds: input.snapshot.rounds,
        turnsUsed: player.turnsUsed,
        guesses:
          input.snapshot.round?.guesses.filter(({ playerId }) => playerId === player.id).length ??
          0,
      },
      event: input.event,
    });
  });
}
function action(value: unknown): HotAndColdAction {
  const data = record(value);
  const actionId = multiplayerText(data.actionId, 80);
  const type = multiplayerText(data.type, 40);
  if (type === "readiness.set" && typeof data.ready === "boolean")
    return { actionId, type, ready: data.ready };
  if (type === "game.configure")
    return {
      actionId,
      type,
      rounds: data.rounds === undefined ? undefined : integer(data.rounds),
      guessesPerPlayer:
        data.guessesPerPlayer === undefined ? undefined : integer(data.guessesPerPlayer),
      turnSeconds: data.turnSeconds === undefined ? undefined : integer(data.turnSeconds),
    };
  if (type === "game.start")
    return {
      actionId,
      type,
      removePlayerIds: Array.isArray(data.removePlayerIds)
        ? data.removePlayerIds.map((id) => multiplayerText(id, 120))
        : undefined,
    };
  if (type === "guess.submit")
    return {
      actionId,
      type,
      roundId: multiplayerText(data.roundId, 120),
      word: multiplayerBoundedText(data.word, 32),
    };
  if (type === "turn.pass" || type === "round.giveUp")
    return { actionId, type, roundId: multiplayerText(data.roundId, 120) };
  if (type === "player.rename")
    return { actionId, type, name: multiplayerBoundedText(data.name, 24).trim() };
  if (type === "host.pass")
    return { actionId, type, playerId: multiplayerText(data.playerId, 120) };
  if (
    type === "round.next" ||
    type === "game.replay" ||
    type === "game.lobby" ||
    type === "player.leave"
  )
    return { actionId, type };
  throw new Error("Invalid action");
}
export const createHotAndColdRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      hostName: multiplayerBoundedText(data.hostName, 24).trim(),
      rounds: data.rounds === undefined ? undefined : integer(data.rounds),
      guessesPerPlayer:
        data.guessesPerPlayer === undefined ? undefined : integer(data.guessesPerPlayer),
      turnSeconds: data.turnSeconds === undefined ? undefined : integer(data.turnSeconds),
    };
  })
  .handler(async ({ data }) => {
    const result = await createHotAndColdRoom(data);
    await recordRoomSnapshot({ snapshot: result.snapshot });
    return result;
  });
export const joinHotAndColdRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : multiplayerCredential(data.joinToken),
      name: multiplayerBoundedText(data.name, 24).trim(),
    };
  })
  .handler(async ({ data }) => {
    const result = await joinHotAndColdRoom(data);
    if (result.ok) await recordRoomSnapshot({ snapshot: result.snapshot });
    return result.ok ? { ...result, joinToken: data.joinToken } : result;
  });
export const readHotAndColdSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: multiplayerText(data.playerId, 120),
      playerToken: multiplayerCredential(data.playerToken),
      lastDigest: typeof data.lastDigest === "string" ? data.lastDigest.slice(0, 24) : null,
    };
  })
  .handler(async ({ data }) => {
    const result = await readHotAndColdSnapshot(data);
    if (result.ok && result.snapshot?.phase === "finished")
      await recordRoomSnapshot({ snapshot: result.snapshot });
    return result;
  });
export const applyHotAndColdActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      playerId: multiplayerText(data.playerId, 120),
      playerToken: multiplayerCredential(data.playerToken),
      action: action(data.action),
    };
  })
  .handler(async ({ data }) => {
    const result = await applyHotAndColdAction(data);
    if (result.ok && result.accepted && result.snapshot) {
      await recordRoomSnapshot({
        snapshot: result.snapshot,
        abandoned: data.action.type === "player.leave",
        event: {
          key: data.action.actionId,
          kind: data.action.type,
          payload:
            data.action.type === "guess.submit"
              ? { word: data.action.word, roundId: data.action.roundId }
              : undefined,
        },
      });
    }
    return result;
  });
export const scoreDailyHotAndColdGuessFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const word = prepareGuess(multiplayerBoundedText(data.word, 32));
    if (!word) throw new Error("Type one English word");
    return {
      word,
      puzzle: playablePuzzle(data.puzzle),
      judgingVersion: currentJudgingVersion(data.judgingVersion),
    };
  })
  .handler(async ({ data }) => {
    try {
      const result = {
        ok: true as const,
        puzzle: data.puzzle,
        ...(await scoreHotAndColdGuess(hotAndColdTargetForPuzzle(data.puzzle), data.word)),
      };
      await recordHistory("daily_guess", { puzzle: result.puzzle }, async () => {
        const personId = await currentPersonId();
        if (personId)
          await recordPersonGame({
            personId,
            game: "hot-and-cold",
            mode: "daily",
            externalRef: dailyHistoryReference(result.puzzle),
            status: result.rank === 0 ? "completed" : "active",
            outcome: result.rank === 0 ? "found" : undefined,
            score: result.rank === 0 ? 0 : undefined,
            summary: {
              judgingVersion: result.judgingVersion,
              latestRank: result.rank,
              target: hotAndColdTargetForPuzzle(result.puzzle),
            },
            event: {
              key: `guess:${result.word}`,
              kind: "guess",
              payload: { word: result.word, rank: result.rank, band: result.band },
            },
          });
      });
      return result;
    } catch (error) {
      if (error instanceof HotAndColdInvalidGuessError)
        return {
          ok: false as const,
          error: "That word is not in our dictionary",
          puzzle: data.puzzle,
        };
      throw error;
    }
  });
export const rescoreSavedDailyHotAndColdWordsFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    if (!Array.isArray(data.words) || data.words.length > 256)
      throw new Error("Invalid saved guesses");
    const words = data.words.map((value) => {
      const word = prepareGuess(multiplayerBoundedText(value, 32));
      if (!word) throw new Error("Invalid saved guess");
      return word;
    });
    return {
      words,
      puzzle: playablePuzzle(data.puzzle),
      judgingVersion: currentJudgingVersion(data.judgingVersion),
    };
  })
  .handler(async ({ data }) => ({
    puzzle: data.puzzle,
    judgingVersion: data.judgingVersion,
    words: await Promise.all(
      data.words.map((word) => scoreHotAndColdGuess(hotAndColdTargetForPuzzle(data.puzzle), word)),
    ),
  }));
export const revealDailyHotAndColdFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      puzzle: playablePuzzle(data.puzzle),
      judgingVersion: currentJudgingVersion(data.judgingVersion),
    };
  })
  .handler(async ({ data }) => {
    const { puzzle } = data;
    void recordHistory("daily_reveal", { puzzle }, async () => {
      const personId = await currentPersonId();
      if (!personId) return;
      await recordPersonGame({
        personId,
        game: "hot-and-cold",
        mode: "daily",
        externalRef: dailyHistoryReference(puzzle),
        status: "completed",
        outcome: "revealed",
        summary: {
          judgingVersion: data.judgingVersion,
          target: hotAndColdTargetForPuzzle(puzzle),
        },
        event: { key: "reveal", kind: "reveal" },
      });
    });
    return {
      puzzle,
      target: hotAndColdTargetForPuzzle(puzzle),
      judgingVersion: data.judgingVersion,
    };
  });
export const getDailyHotAndColdHintFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const usedWords = Array.isArray(data.usedWords)
      ? data.usedWords
          .slice(0, 128)
          .map((word) => prepareGuess(multiplayerBoundedText(word, 32)))
          .filter((word): word is string => Boolean(word))
      : [];
    return {
      puzzle: playablePuzzle(data.puzzle),
      judgingVersion: currentJudgingVersion(data.judgingVersion),
      hintIndex: Math.min(2, integer(data.hintIndex)),
      usedWords,
    };
  })
  .handler(async ({ data }) => {
    const target = hotAndColdTargetForPuzzle(data.puzzle);
    const hint = await hotAndColdHint(target, data.hintIndex, data.usedWords);
    const puzzle = data.puzzle;
    const band = heatBand(hint.rank);
    await recordHistory("daily_hint", { puzzle }, async () => {
      const personId = await currentPersonId();
      if (personId)
        await recordPersonGame({
          personId,
          game: "hot-and-cold",
          mode: "daily",
          externalRef: dailyHistoryReference(puzzle),
          summary: {
            hintsUsed: data.hintIndex + 1,
            judgingVersion: data.judgingVersion,
            target,
          },
          event: {
            key: `hint:${data.hintIndex + 1}`,
            kind: "hint",
            payload: { word: hint.word, rank: hint.rank, band },
          },
        });
    });
    return { ...hint, band, puzzle, judgingVersion: data.judgingVersion };
  });
export const recordDailyHotAndColdResultFn = createServerFn({ method: "POST" })
  .validator((value: unknown): HotAndColdDailyResultInput => {
    const data = record(value);
    const distribution = record(data.distribution);
    const guesses = boundedInteger(data.guesses, 0, 10_000);
    if (data.outcome !== "found" && data.outcome !== "revealed")
      throw new Error("Invalid result outcome");
    const puzzle = playablePuzzle(data.puzzle);
    const summary: HotAndColdDailyResultInput = {
      runId: multiplayerText(data.runId, 36),
      puzzle,
      outcome: data.outcome,
      guesses,
      hints: boundedInteger(data.hints, 0, 3),
      judgingVersion: currentJudgingVersion(data.judgingVersion),
      bestRank: data.bestRank === null ? null : boundedInteger(data.bestRank, 0, 2_147_483_647),
      target: hotAndColdTargetForPuzzle(puzzle),
      distribution: {
        frost: boundedInteger(distribution.frost, 0, 10_000),
        cool: boundedInteger(distribution.cool, 0, 10_000),
        warm: boundedInteger(distribution.warm, 0, 10_000),
        hot: boundedInteger(distribution.hot, 0, 10_000),
      },
    };
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        summary.runId,
      )
    )
      throw new Error("Invalid result identifier");
    const distributed = Object.values(summary.distribution).reduce((sum, count) => sum + count, 0);
    if (distributed > guesses) throw new Error("Invalid result distribution");
    return summary;
  })
  .handler(async ({ data }) => {
    const limit = await reserveRateLimit({
      name: "hot-and-cold-result",
      identity: getRequestIP() || "unknown",
      limit: 30,
      windowSeconds: 60 * 60,
      globalLimit: 3_000,
    });
    if (!limit.allowed) throw new Error("Too many results — try again later");
    const personId = await currentPersonId();
    await recordHotAndColdDailyResult(data, personId);
    await recordHistory("daily_result", { puzzle: data.puzzle }, async () => {
      if (!personId) return;
      await recordPersonGame({
        personId,
        game: "hot-and-cold",
        mode: "daily",
        externalRef: dailyHistoryReference(data.puzzle),
        status: "completed",
        outcome: data.outcome,
        score: data.outcome === "found" ? data.guesses : undefined,
        summary: {
          guesses: data.guesses,
          hintsUsed: data.hints,
          judgingVersion: data.judgingVersion,
          bestRank: data.bestRank,
          target: data.target,
          frostGuesses: data.distribution.frost,
          coolGuesses: data.distribution.cool,
          warmGuesses: data.distribution.warm,
          hotGuesses: data.distribution.hot,
        },
      });
    });
    let community: HotAndColdCommunityStats | null = null;
    try {
      community = await hotAndColdResultCommunityStats(data.puzzle, data.runId);
    } catch (error) {
      log.warn("things.hot-and-cold", "Could not read result community comparison", {
        puzzle: data.puzzle,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    return { recorded: true as const, community };
  });
export const getHotAndColdCommunityStatsFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const runId = multiplayerText(data.runId, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId))
      throw new Error("Invalid result identifier");
    return {
      puzzle: playablePuzzle(data.puzzle),
      runId,
      judgingVersion: currentJudgingVersion(data.judgingVersion),
    };
  })
  .handler(async ({ data }) => ({
    community: await hotAndColdResultCommunityStats(data.puzzle, data.runId),
  }));
export const getHotAndColdOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  const puzzle = hotAndColdPuzzleNumber();
  const history = previousHotAndColdPuzzles();
  let community = new Map<number, HotAndColdCommunityStats>();
  try {
    community = await hotAndColdCommunityStats(history.map((entry) => entry.puzzle));
  } catch (error) {
    log.warn("things.hot-and-cold", "Could not read community results", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
  return {
    puzzle,
    judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
    history: history.map((entry) => ({
      ...entry,
      judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
      community: community.get(entry.puzzle) ?? null,
    })),
  };
});
export const getDailyHotAndColdFn = createServerFn({ method: "GET" }).handler(() => ({
  puzzle: hotAndColdPuzzleNumber(),
  judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
}));
export const getHotAndColdPuzzleFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { puzzle: playablePuzzle(data.puzzle) };
  })
  .handler(({ data }) => ({
    puzzle: data.puzzle,
    date: hotAndColdPuzzleDate(data.puzzle),
    judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
    today: data.puzzle === hotAndColdPuzzleNumber(),
  }));
