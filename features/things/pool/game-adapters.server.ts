import { applyCentreAction, createCentreRoom, joinCentreRoom } from "../centre/centre-room.server";
import type { CentreDifficulty } from "../centre/types";
import {
  applyDrawCountryAction,
  createDrawCountryRoom,
  joinDrawCountryRoom,
} from "../draw-country/draw-country-room.server";
import { applyLiarsPlayerAction, createLiarsRoom, joinLiarsRoom } from "../liars/liars-room.server";
import {
  applyHotAndColdAction,
  createHotAndColdRoom,
  joinHotAndColdRoom,
} from "../hot-and-cold/hot-and-cold-room.server";
import {
  applySameBrainPlayerAction,
  createSameBrainRoom,
  joinSameBrainRoom,
} from "../same-brain/same-brain-room.server";
import { applyTwinAction, createTwinRoom, joinTwinRoom } from "../twin/twin-room.server";
import { GAME_POOL_DEFAULTS } from "./presets";
import type { GameSettingsDocument } from "../shared/game-settings";
import type { GamePoolAssignment, GamePoolGame } from "./types";

export interface CreatedPoolRoom {
  assignment: GamePoolAssignment;
  joinToken: string;
}

export type GamePoolRoomFactory = (input: {
  gameSettings: GameSettingsDocument;
  name: string;
  joinId: string;
}) => Promise<CreatedPoolRoom>;

export class GamePoolJoinError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GamePoolJoinError";
  }
}

function failure(result: { ok: false; error: string; errorCode: string }): never {
  throw new GamePoolJoinError(result.errorCode, result.error);
}

export function gamePoolCapacity(game: GamePoolGame) {
  return GAME_POOL_DEFAULTS[game].capacity;
}

/**
 * Remove a pooled assignment from the game engine that owns its room. The assignment receipt is
 * server-held, so a browser cannot use this path to choose another player to remove.
 */
export async function leavePoolRoom(
  assignment: GamePoolAssignment,
  actionId = crypto.randomUUID(),
) {
  const identity = {
    roomId: assignment.roomId,
    playerId: assignment.playerId,
    playerToken: assignment.playerToken,
  };
  if (assignment.game === "same-brain")
    return applySameBrainPlayerAction({
      ...identity,
      action: { type: "room.leave", actionId },
    });
  if (assignment.game === "liars")
    return applyLiarsPlayerAction({
      ...identity,
      action: { type: "room.leave", actionId },
    });
  if (assignment.game === "centre")
    return applyCentreAction({
      ...identity,
      action: { type: "player.leave", actionId },
    });
  if (assignment.game === "twin")
    return applyTwinAction({
      ...identity,
      action: { type: "player.leave", actionId },
    });
  if (assignment.game === "hot-and-cold")
    return applyHotAndColdAction({
      ...identity,
      action: { type: "player.leave", actionId },
    });
  return applyDrawCountryAction({
    ...identity,
    action: { type: "player.leave", actionId },
  });
}

export async function createPoolRoomAndJoin(input: {
  gameSettings: GameSettingsDocument;
  name: string;
  joinId: string;
}): Promise<CreatedPoolRoom> {
  const { gameSettings, name, joinId } = input;
  const settings = gameSettings.settings;
  if (settings.game === "same-brain") {
    const room = await createSameBrainRoom({
      managed: true,
      rounds: settings.rounds,
      toggles: {
        sayItAloud: settings.sayItAloud,
        eliminateOddOne: settings.eliminateOddOne,
        revealAuthors: settings.revealAuthors,
      },
    });
    const joined = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      hostToken: room.hostToken,
      name,
      joinId,
    });
    if (!joined.ok) return failure(joined);
    return { assignment: { game: settings.game, ...joined }, joinToken: room.joinToken };
  }
  if (settings.game === "liars") {
    const room = await createLiarsRoom({
      managed: true,
      mode: settings.mode,
      roomMode: settings.roomMode,
      toggles: {
        firstGame: settings.firstGame,
        blindImposters: settings.blindImposters,
        wordBoard: settings.wordBoard,
      },
    });
    const joined = await joinLiarsRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      hostToken: room.hostToken,
      name,
      joinId,
    });
    if (!joined.ok) return failure(joined);
    return { assignment: { game: settings.game, ...joined }, joinToken: room.joinToken };
  }
  if (settings.game === "centre") {
    const room = await createCentreRoom({
      managed: true,
      hostName: name,
      difficulty: settings.difficulty as CentreDifficulty,
      delayedRivals: settings.delayedRivals,
    });
    return { assignment: { game: settings.game, ...room }, joinToken: room.joinToken };
  }
  if (settings.game === "twin") {
    const room = await createTwinRoom({
      managed: true,
      hostName: name,
      handSize: settings.handSize,
    });
    return { assignment: { game: settings.game, ...room }, joinToken: room.joinToken };
  }
  if (settings.game === "hot-and-cold") {
    const room = await createHotAndColdRoom({
      managed: true,
      hostName: name,
      rounds: settings.rounds,
      guessesPerPlayer: settings.guessesPerPlayer,
      turnSeconds: settings.turnSeconds,
    });
    return { assignment: { game: settings.game, ...room }, joinToken: room.joinToken };
  }
  const room = await createDrawCountryRoom({
    managed: true,
    hostName: name,
    drawSeconds: settings.drawSeconds,
    roundTotal: settings.roundTotal,
    recentCountryIds: [],
  });
  return { assignment: { game: settings.game, ...room }, joinToken: room.joinToken };
}

export async function joinPoolRoom(input: {
  game: GamePoolGame;
  roomId: string;
  joinToken: string;
  name: string;
  joinId: string;
}): Promise<GamePoolAssignment> {
  const { game, roomId, joinToken, name, joinId } = input;
  if (game === "same-brain") {
    const joined = await joinSameBrainRoom({ roomId, joinToken, name, joinId });
    if (!joined.ok) return failure(joined);
    return { game, ...joined };
  }
  if (game === "liars") {
    const joined = await joinLiarsRoom({ roomId, joinToken, name, joinId });
    if (!joined.ok) return failure(joined);
    return { game, ...joined };
  }
  if (game === "centre") {
    const joined = await joinCentreRoom({ roomId, joinToken, name });
    if (!joined.ok) return failure(joined);
    return { game, ...joined };
  }
  if (game === "twin") {
    const joined = await joinTwinRoom({ roomId, joinToken, name });
    if (!joined.ok) return failure(joined);
    return { game, ...joined };
  }
  if (game === "hot-and-cold") {
    const joined = await joinHotAndColdRoom({ roomId, joinToken, name });
    if (!joined.ok) return failure(joined);
    return { game, ...joined };
  }
  const joined = await joinDrawCountryRoom({ roomId, joinToken, name });
  if (!joined.ok) return failure(joined);
  return { game, ...joined };
}
