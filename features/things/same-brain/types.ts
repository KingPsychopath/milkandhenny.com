import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";

/**
 * `sayIt` is the beat between locking answers and seeing the result: every phone counts down
 * together, then shows its owner their own word to read out loud. Nobody else's word is on any
 * screen during it, so the room hears all of them at once and the screen only confirms it afterwards.
 */
export type SameBrainPhase = "lobby" | "prompt" | "submit" | "sayIt" | "reveal" | "ending";

export interface SameBrainToggles {
  /**
   * Count down and say the answers out loud before the reveal. On for a room full of people, off for
   * a game played over a call, where seven seconds of silence is just seven seconds of silence.
   */
  sayItAloud: boolean;
  /** House rule. A player alone in their answer is out of the game, not merely unscored. */
  eliminateOddOne: boolean;
  /** Off makes the reveal anonymous, which is a different and louder game. */
  revealAuthors: boolean;
}

export interface SameBrainTimings {
  prompt: number;
  submit: number;
  /** Countdown plus the hold on your own word. Ignored when `sayItAloud` is off. */
  sayIt: number;
  reveal: number;
}

export interface SameBrainPlayerSummary {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  host: boolean;
  /** Permanently departed or removed after play started. */
  left?: boolean;
  score: number;
  /** Out of the game under the odd-one-out house rule. */
  out: boolean;
  /** Rounds this player was alone in their answer. Kept even when the rule is off. */
  aloneCount: number;
  /** During submit, whether they have answered — never what they answered. */
  answered: boolean;
}

/** One group of players who gave the same normalised answer. */
export interface SameBrainCluster {
  /** The answer that represents the group — the earliest spelling anybody typed in it. */
  label: string;
  /** Every distinct spelling that landed in this group, `label` first. */
  spellings: string[];
  playerIds: string[];
}

export interface SameBrainAnswer {
  playerId: string;
  /** Exactly what they typed, for the reveal. */
  text: string;
  /** The normalised form used for grouping. */
  normalised: string;
}

export interface SameBrainRoundResult {
  round: number;
  question: string;
  answers: SameBrainAnswer[];
  clusters: SameBrainCluster[];
  /** Index into `clusters`, or null when the room split and nobody scored. */
  herdIndex: number | null;
  pointsEach: number;
  /** Set only when exactly one player stood alone against a herd. */
  oddPlayerId: string | null;
  /** Set when nobody scored, so the reveal can say why rather than showing an empty herd. */
  noScoreReason: "split" | null;
  /** True once the host has merged groups by hand, so the reveal can say the room decided this. */
  corrected?: boolean;
}

export interface SameBrainSnapshot extends MultiplayerSequence {
  /** Hash of this viewer's redacted view, filled in by the read. */
  digest?: string;
  roomId: string;
  managed?: boolean;
  phase: SameBrainPhase;
  revision: number;
  serverNow: number;
  expiresAt: number;
  round: number;
  rounds: number;
  toggles: SameBrainToggles;
  timings: SameBrainTimings;
  phaseStartedAt: number;
  phaseEndsAt: number;
  /** Frozen by the host. Countdowns stop and the round waits. */
  paused: boolean;
  players: SameBrainPlayerSummary[];
  hostPlayerId: string | null;
  hostDisconnected: boolean;
  you: {
    id: string;
    /** Your own answer this round, echoed back so a reconnect does not lose it. */
    answer: string | null;
    out: boolean;
    /** Set when the host tried to start while you were not ready — the buzz. */
    startRequestId: string | null;
  } | null;
  /** The current question. Null in the lobby. */
  question: string | null;
  /** Populated at reveal only. */
  result: SameBrainRoundResult | null;
  /** Every finished round, for the ending. */
  history: SameBrainRoundResult[];
  winnerIds: string[];
}

export type SameBrainRoomErrorCode =
  | "room_unavailable"
  | "invite_expired"
  | "game_started"
  | "invalid_name"
  | "name_taken"
  | "room_full"
  | "not_host";

export type SameBrainRejectionCode =
  | "room_unavailable"
  | "phase_ended"
  | "already_answered"
  | "invalid_answer"
  | "action_unavailable"
  | "out_of_game"
  | "not_enough_players"
  | "players_not_ready";

export type SameBrainHostAction = MultiplayerAction &
  (
    | {
        type: "game.configure";
        rounds?: number;
        toggles?: Partial<SameBrainToggles>;
        timings?: Partial<SameBrainTimings>;
      }
    | { type: "game.start"; removePlayerIds?: string[] }
    | { type: "game.skipQuestion" }
    | { type: "phase.extend" }
    | { type: "phase.advance" }
    | { type: "phase.pause" | "phase.resume" }
    /**
     * The host can group two answers when the room agrees they meant the same thing. `from` and `to`
     * are indices into `result.clusters`; the round is re-scored from the chosen grouping.
     */
    | { type: "result.merge"; round: number; from: number; to: number }
    | { type: "result.reset"; round: number }
    | { type: "player.remove"; playerId: string }
    | { type: "host.pass"; playerId: string }
    | { type: "game.replay" | "game.lobby" | "game.end" }
  );

export type SameBrainPlayerAction = MultiplayerAction &
  (
    | { type: "room.leave" }
    | { type: "player.rename"; name: string }
    | { type: "readiness.set"; ready: boolean }
    | { type: "answer.submit"; round: number; text: string }
    | { type: "answer.clear"; round: number }
    | { type: "host.claim" }
  );

export interface SameBrainRoomCredentials extends MultiplayerRoomLifetime {
  hostToken: string;
  joinToken: string;
}

export interface SameBrainPlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  snapshot?: SameBrainSnapshot;
}

export type SameBrainJoinResult =
  | MultiplayerSuccess<{
      roomId: string;
      playerId: string;
      playerToken: string;
      expiresAt: number;
      snapshot: SameBrainSnapshot;
    }>
  | MultiplayerFailure<SameBrainRoomErrorCode>;

export type SameBrainSnapshotResult =
  // `unchanged` sits on both success arms so it discriminates them; without it here, narrowing
  // leaves `snapshot` nullable at every call site.
  | MultiplayerSuccess<{ unchanged?: false; snapshot: SameBrainSnapshot }>
  /** The viewer's digest matched, so the body was left off. */
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<SameBrainRoomErrorCode> & { snapshot: null });

export type SameBrainActionResult =
  | { accepted: true; snapshot: SameBrainSnapshot }
  | {
      accepted: false;
      errorCode: SameBrainRejectionCode;
      error: string;
      snapshot: SameBrainSnapshot | null;
    };
