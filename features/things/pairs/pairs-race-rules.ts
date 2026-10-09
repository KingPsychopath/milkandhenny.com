import { applyPairsAction, createPairsGame } from "./pairs-rules";
import type { PairsGame, PairsSize } from "./pairs-rules";

export interface PairsRacer {
  id: string;
  name: string;
  tokenHash: string;
  ready: boolean;
  wins: number;
  game: PairsGame | null;
  unlockAt: number;
}
export interface PairsRace {
  roomId: string;
  expiresAt: number;
  pairCount: PairsSize;
  phase: "lobby" | "playing" | "reveal" | "finished";
  round: number;
  players: PairsRacer[];
  winnerId: string | null;
  conceded: boolean;
  startsAt: number;
}
export type PairsRaceAction =
  | { type: "ready"; ready: boolean }
  | { type: "begin" }
  | { type: "flip"; index: number; round: number }
  | { type: "concede" };

export interface PairsRaceSnapshot {
  roomId: string;
  expiresAt: number;
  revision: number;
  serverNow: number;
  pairCount: PairsSize;
  phase: PairsRace["phase"];
  round: number;
  players: {
    id: string;
    name: string;
    ready: boolean;
    wins: number;
    pairs: number;
    tries: number;
  }[];
  playerId: string;
  game: PairsGame | null;
  winnerId: string | null;
  conceded: boolean;
  startsAt: number;
}

export function advancePairsRacer(player: PairsRacer, now: number) {
  if (player.game?.phase === "review" && now >= player.unlockAt) {
    player.game = applyPairsAction(player.game, { type: "continue" });
    player.unlockAt = 0;
  }
}

/** One atomic room transition decides the winner; device clocks and claimed finishes never do. */
export function applyPairsRaceAction(
  room: PairsRace,
  playerId: string,
  action: PairsRaceAction,
  context: { now: number; seed: number },
): string | null {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) return "This player is no longer here";
  if (action.type === "ready") {
    if (room.phase === "playing") return "The round is already playing";
    player.ready = action.ready;
    return null;
  }
  if (action.type === "begin") {
    if (room.phase === "playing") return "The round is already playing";
    if (room.players.length !== 2 || room.players.some((candidate) => !candidate.ready))
      return "Both players need to be ready";
    const rematch = room.phase === "finished";
    room.round = rematch ? 1 : room.round + 1;
    room.phase = "playing";
    room.winnerId = null;
    room.conceded = false;
    room.startsAt = context.now + 3000;
    for (const candidate of room.players) {
      candidate.ready = false;
      if (rematch) candidate.wins = 0;
      candidate.game = createPairsGame(context.seed, room.pairCount, [candidate.name]);
      candidate.unlockAt = 0;
    }
    return null;
  }
  if (action.type === "concede") {
    if (room.phase !== "playing") return "There is no live round to concede";
    const opponent = room.players.find((candidate) => candidate.id !== player.id);
    if (!opponent) return "There is no opponent";
    opponent.wins = 2;
    room.winnerId = opponent.id;
    room.phase = "finished";
    room.conceded = true;
    for (const candidate of room.players) candidate.ready = false;
    return null;
  }
  if (room.phase !== "playing" || action.round !== room.round || !player.game)
    return "That round has ended";
  if (context.now < room.startsAt) return "The round is about to start";
  advancePairsRacer(player, context.now);
  const game = applyPairsAction(player.game, { type: "flip", index: action.index });
  if (game === player.game) return "That card is not available yet";
  player.game = game;
  if (game.phase === "review")
    player.unlockAt = context.now + (game.outcome === "match" ? 1300 : 1400);
  if (game.matched.length === game.cards.length) {
    player.wins++;
    room.winnerId = player.id;
    room.phase = player.wins === 2 ? "finished" : "reveal";
    for (const candidate of room.players) candidate.ready = false;
  }
  return null;
}

export function pairsRaceSnapshot(
  room: PairsRace,
  playerId: string,
  revision: number,
  now: number,
): PairsRaceSnapshot {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Player not found");
  const privateGame = player.game ? structuredClone(player.game) : null;
  if (privateGame?.phase === "review" && now >= player.unlockAt)
    Object.assign(privateGame, applyPairsAction(privateGame, { type: "continue" }));
  if (privateGame) {
    privateGame.cards = privateGame.cards.map((card, index) =>
      privateGame.selected.includes(index) || privateGame.matched.includes(index)
        ? card
        : { rank: "", suit: "♠" },
    );
    privateGame.previous = null;
  }
  return {
    roomId: room.roomId,
    expiresAt: room.expiresAt,
    revision,
    serverNow: now,
    pairCount: room.pairCount,
    phase: room.phase,
    round: room.round,
    players: room.players.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      ready: candidate.ready,
      wins: candidate.wins,
      pairs: (candidate.game?.matched.length ?? 0) / 2,
      tries: candidate.game?.tries ?? 0,
    })),
    playerId,
    game: privateGame,
    winnerId: room.winnerId,
    conceded: room.conceded,
    startsAt: room.startsAt,
  };
}
