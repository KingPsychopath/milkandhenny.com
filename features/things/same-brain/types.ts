import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";

/**
 * How two answers are judged to be the same answer.
 *
 * `exact` compares normalised strings and nothing else: deterministic, explicable, and the whole
 * game works on it. `embedding` additionally merges near-misses — sea/ocean, knife/cutlery — which
 * is the only job the model has. It never decides who is odd, only whether two people who agreed
 * in substance are treated as having agreed.
 */
export type SameBrainScoring = "exact" | "embedding";

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
  /** Name the answers the model merged, so a group can overrule it out loud. */
  showMachineWorking: boolean;
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
  score: number;
  /** Out of the game under the odd-one-out house rule. */
  out: boolean;
  /** Rounds this player was alone in their answer. Kept even when the rule is off. */
  aloneCount: number;
  /** During submit, whether they have answered — never what they answered. */
  answered: boolean;
}

/** One group of players judged to have given the same answer. */
export interface SameBrainCluster {
  /** The answer that represents the group — the earliest spelling anybody typed in it. */
  label: string;
  /** Every distinct spelling that landed in this group, `label` first. */
  spellings: string[];
  playerIds: string[];
  /** True when the model merged spellings the exact pass had kept apart. */
  merged: boolean;
}

export interface SameBrainAnswer {
  playerId: string;
  /** Exactly what they typed, for the reveal. */
  text: string;
  /** What the scorer compared. */
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
  /** Present when the model changed the outcome, for the reveal to quote. */
  machineNote: string | null;
  /** Set when nobody scored, so the reveal can say why rather than showing an empty herd. */
  noScoreReason: "split" | null;
  /** True once the host has merged groups by hand, so the reveal can say the room decided this. */
  corrected?: boolean;
}

export interface SameBrainSnapshot extends MultiplayerSequence {
  roomId: string;
  phase: SameBrainPhase;
  revision: number;
  serverNow: number;
  round: number;
  rounds: number;
  scoring: SameBrainScoring;
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
  | "not_enough_players";

export type SameBrainHostAction = MultiplayerAction &
  (
    | {
        type: "game.configure";
        rounds?: number;
        scoring?: SameBrainScoring;
        toggles?: Partial<SameBrainToggles>;
        timings?: Partial<SameBrainTimings>;
      }
    | { type: "game.start" }
    | { type: "game.skipQuestion" }
    | { type: "phase.extend" }
    | { type: "phase.advance" }
    | { type: "phase.pause" | "phase.resume" }
    /**
     * The room overruling the scorer, at the reveal, on the round being looked at.
     *
     * This is how typos, regional words, missed synonyms and anything the model got wrong all get
     * fixed — by the people who heard what was meant, rather than by a cleverer guess. `from` and
     * `to` are indices into `result.clusters`; the round is re-scored from scratch afterwards.
     */
    | { type: "result.merge"; round: number; from: number; to: number }
    | { type: "result.reset"; round: number }
    | { type: "player.remove"; playerId: string }
    | { type: "game.replay" | "game.lobby" | "game.end" }
  );

export type SameBrainPlayerAction = MultiplayerAction &
  (
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
  | MultiplayerSuccess<{ snapshot: SameBrainSnapshot }>
  | (MultiplayerFailure<SameBrainRoomErrorCode> & { snapshot: null });

export type SameBrainActionResult =
  | { accepted: true; snapshot: SameBrainSnapshot }
  | {
      accepted: false;
      errorCode: SameBrainRejectionCode;
      error: string;
      snapshot: SameBrainSnapshot | null;
    };
