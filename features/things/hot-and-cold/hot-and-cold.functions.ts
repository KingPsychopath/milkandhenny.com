import { createServerFn } from "@tanstack/react-start";
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
import { prepareGuess } from "./hot-and-cold-rules";
import { scoreHotAndColdGuess } from "./hot-and-cold-scorer.server";
import { dailyHotAndColdTarget, hotAndColdPuzzleNumber } from "./hot-and-cold-words.server";
import type { HotAndColdAction } from "./types";

const record = multiplayerRecord;
const integer = (value: unknown) => multiplayerSequence(value);
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
  .handler(({ data }) => createHotAndColdRoom(data));
export const joinHotAndColdRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      joinToken: data.joinToken === undefined ? undefined : multiplayerCredential(data.joinToken),
      name: multiplayerBoundedText(data.name, 24).trim(),
    };
  })
  .handler(({ data }) => joinHotAndColdRoom(data));
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
  .handler(({ data }) => readHotAndColdSnapshot(data));
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
  .handler(({ data }) => applyHotAndColdAction(data));
export const scoreDailyHotAndColdGuessFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const word = prepareGuess(multiplayerBoundedText(data.word, 32));
    if (!word) throw new Error("Type one English word");
    return { word };
  })
  .handler(async ({ data }) => ({
    word: data.word,
    puzzle: hotAndColdPuzzleNumber(),
    ...(await scoreHotAndColdGuess(dailyHotAndColdTarget(), data.word)),
  }));
export const revealDailyHotAndColdFn = createServerFn({ method: "GET" }).handler(() => ({
  puzzle: hotAndColdPuzzleNumber(),
  target: dailyHotAndColdTarget(),
}));
export const getDailyHotAndColdFn = createServerFn({ method: "GET" }).handler(() => ({
  puzzle: hotAndColdPuzzleNumber(),
}));
