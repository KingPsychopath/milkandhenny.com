import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRoomLifetime,
  MultiplayerSuccess,
} from "../shared/multiplayer";
import type { MultiplayerReadiness } from "../shared/multiplayer-readiness";
import type { HeatBand } from "./hot-and-cold-rules";

export type HotAndColdPhase = "lobby" | "playing" | "reveal" | "finished" | "closed";

export interface HotAndColdGuess {
  id: string;
  sequence: number;
  playerId: string;
  playerName: string;
  word: string;
  rank: number;
  band: HeatBand;
  createdAt: number;
}

export interface HotAndColdPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  host: boolean;
  score: number;
  sessionScore: number;
  turnsUsed: number;
  gaveUp: boolean;
  withdrawn: boolean;
}

export interface HotAndColdRound {
  id: string;
  number: number;
  total: number;
  currentPlayerId: string | null;
  turnEndsAt: number | null;
  guesses: HotAndColdGuess[];
  winnerIds: string[];
  exact: boolean;
  openingGuess: boolean;
  target: string | null;
}

export interface HotAndColdSnapshot extends MultiplayerReadiness {
  digest?: string;
  roomId: string;
  phase: HotAndColdPhase;
  revision: number;
  sequence: number;
  serverNow: number;
  expiresAt: number;
  managed?: boolean;
  gameNumber: number;
  hostPlayerId: string;
  canControl: boolean;
  rounds: number;
  guessesPerPlayer: number;
  turnSeconds: number;
  players: HotAndColdPlayer[];
  playerId: string;
  round: HotAndColdRound | null;
  winnerIds: string[];
}

export interface HotAndColdCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  joinToken?: string;
  snapshot: HotAndColdSnapshot;
}

export type HotAndColdJoinResult =
  | MultiplayerSuccess<HotAndColdCredentials>
  | MultiplayerFailure<
      | "game_started"
      | "invite_expired"
      | "invalid_name"
      | "name_taken"
      | "room_full"
      | "room_unavailable"
    >;

export type HotAndColdAction = MultiplayerAction &
  (
    | { type: "readiness.set"; ready: boolean }
    | { type: "game.configure"; rounds?: number; guessesPerPlayer?: number; turnSeconds?: number }
    | { type: "game.start"; removePlayerIds?: string[] }
    | { type: "guess.submit"; word: string; roundId: string }
    | { type: "turn.pass"; roundId: string }
    | { type: "round.giveUp"; roundId: string }
    | { type: "round.next" }
    | { type: "game.replay" | "game.lobby" | "player.leave" }
    | { type: "player.rename"; name: string }
    | { type: "host.pass"; playerId: string }
  );

export type HotAndColdActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: HotAndColdSnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      errorCode:
        | "action_unavailable"
        | "players_not_ready"
        | "invalid_guess"
        | "duplicate_guess"
        | "scorer_unavailable";
      error: string;
      snapshot: HotAndColdSnapshot;
    }>
  | (MultiplayerFailure<"room_unavailable"> & { accepted: false; snapshot: null });

export type HotAndColdSnapshotResult =
  | MultiplayerSuccess<{ unchanged?: false; snapshot: HotAndColdSnapshot }>
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export interface SoloHotAndColdGuess {
  word: string;
  rank: number;
  band: HeatBand;
  sequence: number;
  createdAt: number;
  hint?: boolean;
}

export interface HotAndColdDailyResultInput {
  runId: string;
  puzzle: number;
  outcome: "found" | "revealed";
  guesses: number;
  hints: number;
  bestRank: number | null;
  distribution: { frost: number; cool: number; warm: number; hot: number };
}

export type HotAndColdCommunityStats =
  | { runs: number; visible: false }
  | {
      runs: number;
      visible: true;
      solveRate: number;
      medianGuesses: number | null;
      distribution: { frost: number; cool: number; warm: number; hot: number };
      standing?: {
        rank: number;
        runs: number;
        tied: boolean;
        topPercent: number;
        hints: number;
        medianGuesses: number;
      } | null;
    };
