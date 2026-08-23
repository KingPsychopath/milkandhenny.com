import type {
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomIdentity,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";
import type { MultiplayerReadiness } from "../shared/multiplayer-readiness";
import type { TwinOrder } from "./twin-deck";

export type TwinPhase = "lobby" | "dealing" | "heat" | "settle" | "finished" | "closed";

/** A card as it reaches a client: its symbols, and the seed its layout is derived from. */
export interface TwinDealtCard {
  cardId: string;
  symbolIds: string[];
  seed: number;
}

export interface TwinPlayerSummary {
  id: string;
  name: string;
  cardsLeft: number;
  /** Consecutive heats landed. Reset by a miss. */
  chain: number;
  longestChain: number;
  connections: number;
  misses: number;
  connected: boolean;
  ready: boolean;
  host: boolean;
  /** Finishing position, set when their hand empties. */
  place: number | null;
  withdrawn: boolean;
}

export interface TwinHeatResult {
  playerId: string;
  name: string;
  /** Recorded time, after the clamps. Null means they never found it. */
  elapsedMs: number | null;
  misses: number;
  shed: boolean;
  /** Set the next middle card. */
  won: boolean;
  /** The card and symbol this player actually connected in the completed heat. */
  connection: { card: TwinDealtCard; symbolId: string } | null;
}

export interface TwinHeatSnapshot {
  id: string;
  number: number;
  middle: TwinDealtCard;
  /** Frozen before payout so the result never uses the next heat's promoted middle card. */
  playedMiddle: TwinDealtCard;
  /** Absolute and server-owned. Every device animates against these. */
  revealAt: number;
  deadlineAt: number;
  /** Set the moment somebody lands it. */
  graceEndsAt: number | null;
  resolvedAt: number | null;
  /** Payouts are computed here, a beat after the close, so a late-delivered tap still counts. */
  settleAt: number | null;
  /** Set at payout so every client can schedule the next heat without waiting for a safety poll. */
  nextHeatAt: number | null;
  /** A count while the heat is live — never names, which would say who to watch. */
  landedCount: number;
  /** Empty until `settleAt`. */
  results: TwinHeatResult[];
  /** Set at settle when nobody found it, and every hand rotated instead. */
  burned: boolean;
}

export interface TwinPrivateState extends MultiplayerReadiness {
  playerId: string;
  top: TwinDealtCard | null;
  /**
   * The rest of your hand, top first. Sent for the visible stack count but kept face down so nobody
   * can pre-scan while a result animates.
   */
  rest: TwinDealtCard[];
  /** Your recorded time this heat, once the server accepted it. */
  landedMs: number | null;
  misses: number;
  cooldownUntil: number | null;
  chain: number;
}

export interface TwinAward {
  label: string;
  name: string;
  detail: string;
}

/** One player's shed card in a heat, and the symbol that shed it. */
export interface TwinLoggedConnection {
  playerId: string;
  name: string;
  card: TwinDealtCard;
  symbolId: string;
  elapsedMs: number;
  won: boolean;
}

export interface TwinLoggedHeat {
  number: number;
  middle: TwinDealtCard;
  connections: TwinLoggedConnection[];
  missedBy: string[];
  burned: boolean;
}

/**
 * The end of the game as it appears in the snapshot: small, derived from player stats, and safe to
 * re-send on every poll.
 *
 * The heat log is deliberately *not* here. Serving it in the snapshot would put six hundred records
 * back on the polling path the moment the game finished, which is the thing the separate log key
 * exists to avoid. The constellation fetches it once, by itself.
 */
export interface TwinEndingSnapshot {
  winnerPlayerId: string | null;
  headline: string;
  awards: TwinAward[];
  heatCount: number;
}

export type TwinLogResult =
  | MultiplayerSuccess<{ heats: TwinLoggedHeat[] }>
  | MultiplayerFailure<"room_unavailable">;

export interface TwinSnapshot
  extends MultiplayerRoomIdentity, MultiplayerRevision, MultiplayerSequence {
  /** Hash of this viewer's redacted view, filled in by the read. */
  digest?: string;
  managed?: boolean;
  phase: TwinPhase;
  serverNow: number;
  expiresAt: number;
  gameNumber: number;
  hostPlayerId: string;
  canControl: boolean;
  order: TwinOrder;
  handSize: number;
  windowMs: number;
  graceMs: number;
  players: TwinPlayerSummary[];
  heat: TwinHeatSnapshot | null;
  player: TwinPrivateState | null;
  /** Populated at `finished` only. */
  ending: TwinEndingSnapshot | null;
}

export interface TwinRoomCredentials extends MultiplayerRoomLifetime {
  hostToken: string;
  joinToken: string;
}

export interface TwinPlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  snapshot: TwinSnapshot;
}

export type TwinJoinErrorCode =
  | "game_started"
  | "invite_expired"
  | "invalid_name"
  | "name_taken"
  | "room_full"
  | "room_unavailable";

export type TwinRejectionCode =
  | "action_unavailable"
  | "players_not_ready"
  | "heat_ended"
  | "wrong_symbol"
  | "cooling_down"
  | "already_landed"
  | "not_host"
  | "deck_too_small";

export type TwinJoinResult =
  | MultiplayerSuccess<TwinPlayerCredentials>
  | MultiplayerFailure<TwinJoinErrorCode>;

export type TwinSnapshotResult =
  | MultiplayerSuccess<{ unchanged?: false; snapshot: TwinSnapshot }>
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type TwinHostAction =
  | { type: "game.start"; removePlayerIds?: string[] }
  | { type: "game.configure"; handSize?: number; windowMs?: number; graceMs?: number }
  | { type: "game.replay" }
  | { type: "game.lobby" }
  | { type: "timing.configure"; settleHoldMs: number }
  | { type: "heat.next" };

export type TwinPlayerAction =
  | { type: "readiness.set"; ready: boolean }
  | { type: "answer.tap"; heatId: string; symbolId: string; elapsedMs: number }
  | { type: "player.leave" };

export type TwinAction = TwinHostAction | TwinPlayerAction;

export type TwinActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: TwinSnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      snapshot: TwinSnapshot;
      errorCode: TwinRejectionCode;
      error: string;
      retryable: boolean;
    }>
  | (MultiplayerFailure<"room_unavailable"> & { accepted: false; snapshot: null });
