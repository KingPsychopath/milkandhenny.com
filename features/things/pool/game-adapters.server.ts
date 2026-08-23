import { createCentreRoom, joinCentreRoom } from "../centre/centre-room.server";
import type { CentreDifficulty } from "../centre/types";
import {
  createDrawCountryRoom,
  joinDrawCountryRoom,
} from "../draw-country/draw-country-room.server";
import { createLiarsRoom, joinLiarsRoom } from "../liars/liars-room.server";
import { createSameBrainRoom, joinSameBrainRoom } from "../same-brain/same-brain-room.server";
import { createTwinRoom, joinTwinRoom } from "../twin/twin-room.server";
import { GAME_POOL_DEFAULTS } from "./presets";
import type { GamePoolAssignment, GamePoolGame, GamePoolPreset } from "./types";

interface CreatedPoolRoom {
  assignment: GamePoolAssignment;
  joinToken: string;
}

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

export async function createPoolRoomAndJoin(input: {
  preset: GamePoolPreset;
  name: string;
  joinId: string;
}): Promise<CreatedPoolRoom> {
  const { preset, name, joinId } = input;
  if (preset.game === "same-brain") {
    const room = await createSameBrainRoom({
      managed: true,
      rounds: preset.rounds,
      scoring: preset.scoring,
      toggles: {
        sayItAloud: preset.sayItAloud,
        eliminateOddOne: preset.eliminateOddOne,
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
    return { assignment: { game: preset.game, ...joined }, joinToken: room.joinToken };
  }
  if (preset.game === "liars") {
    const room = await createLiarsRoom({
      managed: true,
      mode: preset.mode,
      roomMode: preset.roomMode,
      toggles: {
        firstGame: preset.firstGame,
        blindImposters: preset.blindImposters,
        wordBoard: preset.wordBoard,
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
    return { assignment: { game: preset.game, ...joined }, joinToken: room.joinToken };
  }
  if (preset.game === "centre") {
    const room = await createCentreRoom({
      managed: true,
      hostName: name,
      difficulty: preset.difficulty as CentreDifficulty,
      delayedRivals: preset.delayedRivals,
    });
    return { assignment: { game: preset.game, ...room }, joinToken: room.joinToken };
  }
  if (preset.game === "twin") {
    const room = await createTwinRoom({ managed: true, hostName: name, handSize: preset.handSize });
    return { assignment: { game: preset.game, ...room }, joinToken: room.joinToken };
  }
  const room = await createDrawCountryRoom({
    managed: true,
    hostName: name,
    drawSeconds: preset.drawSeconds,
    roundTotal: preset.roundTotal,
    recentCountryIds: [],
  });
  return { assignment: { game: preset.game, ...room }, joinToken: room.joinToken };
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
  const joined = await joinDrawCountryRoom({ roomId, joinToken, name });
  if (!joined.ok) return failure(joined);
  return { game, ...joined };
}
