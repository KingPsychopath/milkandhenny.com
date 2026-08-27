import { createServerFn } from "@tanstack/react-start";
import { getAttendeeSession } from "@/features/event-scoring/session.server";
import { recordPersonGame } from "@/features/person-games/history.server";
import { log } from "@/lib/platform/logger.server";
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
import { heatBand, prepareGuess } from "./hot-and-cold-rules";
import { hotAndColdHint } from "./hot-and-cold-lexicon.server";
import { HotAndColdInvalidGuessError, scoreHotAndColdGuess } from "./hot-and-cold-scorer.server";
import {
  dailyHotAndColdTarget,
  hotAndColdPuzzleNumber,
  previousHotAndColdPuzzles,
} from "./hot-and-cold-words.server";
import type { HotAndColdAction, HotAndColdSnapshot } from "./types";

const record = multiplayerRecord;
const integer = (value: unknown) => multiplayerSequence(value);

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
    return { word };
  })
  .handler(async ({ data }) => {
    try {
      const result = {
        ok: true as const,
        puzzle: hotAndColdPuzzleNumber(),
        ...(await scoreHotAndColdGuess(dailyHotAndColdTarget(), data.word)),
      };
      await recordHistory("daily_guess", { puzzle: result.puzzle }, async () => {
        const personId = await currentPersonId();
        if (personId)
          await recordPersonGame({
            personId,
            game: "hot-and-cold",
            mode: "daily",
            externalRef: String(result.puzzle),
            status: result.rank === 0 ? "completed" : "active",
            outcome: result.rank === 0 ? "found" : undefined,
            score: result.rank === 0 ? 0 : undefined,
            summary: { latestRank: result.rank },
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
          puzzle: hotAndColdPuzzleNumber(),
        };
      throw error;
    }
  });
export const revealDailyHotAndColdFn = createServerFn({ method: "POST" }).handler(async () => {
  const puzzle = hotAndColdPuzzleNumber();
  void recordHistory("daily_reveal", { puzzle }, async () => {
    const personId = await currentPersonId();
    if (!personId) return;
    await recordPersonGame({
      personId,
      game: "hot-and-cold",
      mode: "daily",
      externalRef: String(puzzle),
      status: "completed",
      outcome: "revealed",
      event: { key: "reveal", kind: "reveal" },
    });
  });
  return { puzzle, target: dailyHotAndColdTarget() };
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
    return { hintIndex: Math.min(2, integer(data.hintIndex)), usedWords };
  })
  .handler(async ({ data }) => {
    const target = dailyHotAndColdTarget();
    const hint = await hotAndColdHint(target, data.hintIndex, data.usedWords);
    const puzzle = hotAndColdPuzzleNumber();
    const band = heatBand(hint.rank);
    await recordHistory("daily_hint", { puzzle }, async () => {
      const personId = await currentPersonId();
      if (personId)
        await recordPersonGame({
          personId,
          game: "hot-and-cold",
          mode: "daily",
          externalRef: String(puzzle),
          summary: { hintsUsed: data.hintIndex + 1 },
          event: {
            key: `hint:${data.hintIndex + 1}`,
            kind: "hint",
            payload: { word: hint.word, rank: hint.rank, band },
          },
        });
    });
    return { ...hint, band, puzzle };
  });
export const getHotAndColdOverviewFn = createServerFn({ method: "GET" }).handler(() => ({
  puzzle: hotAndColdPuzzleNumber(),
  history: previousHotAndColdPuzzles(),
}));
export const getDailyHotAndColdFn = createServerFn({ method: "GET" }).handler(() => ({
  puzzle: hotAndColdPuzzleNumber(),
}));
