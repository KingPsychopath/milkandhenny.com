import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";

export type FamilyFeudTeamId = "one" | "two";

export type FamilyFeudPhase =
  | "lobby"
  | "rules"
  | "practice"
  | "round-intro"
  | "category"
  | "faceoff"
  | "main-ready"
  | "main"
  | "steal-ready"
  | "steal"
  | "round-reveal"
  | "round-score"
  | "finished";

export type FamilyFeudViewerRole = "presenter" | "controller" | "buzzer";

export type FamilyFeudVibeId =
  | "london-link-up"
  | "family-function"
  | "night-out"
  | "after-dark"
  | "full-london-mix"
  | "choose-own";

export interface FamilyFeudAnswerDefinition {
  id: string;
  label: string;
  aliases: string[];
}

export interface FamilyFeudCardDefinition {
  id: string;
  prompt: string;
  answers: FamilyFeudAnswerDefinition[];
  deckId?: string;
  deckName?: string;
  adultOnly?: boolean;
  provenance?: {
    kind: "original" | "protoqa-adapted";
    sourceId?: string;
  };
}

export interface FamilyFeudDeckSummary {
  id: string;
  name: string;
  description: string;
  cardCount: number;
  adultOnly?: boolean;
}

export interface FamilyFeudVibeSummary {
  id: FamilyFeudVibeId;
  name: string;
  description: string;
  deckIds: readonly string[];
}

export interface FamilyFeudCustomDeckInput {
  id: string;
  name: string;
  cards: FamilyFeudCardDefinition[];
}

export interface FamilyFeudTeamSnapshot {
  id: FamilyFeudTeamId;
  marker: "circle" | "triangle";
  name: string;
  playerCount: number;
  score: number;
  roundPoints: number;
}

export interface FamilyFeudAnswerSnapshot {
  id: string;
  position: number;
  boardValue: number;
  label?: string;
  aliases?: string[];
  shown: boolean;
  revealed: boolean;
  awardedTeamId?: FamilyFeudTeamId;
  points?: number;
}

export interface FamilyFeudHouseAnswerSnapshot {
  id: string;
  label: string;
  teamId: FamilyFeudTeamId;
  points: number;
}

export interface FamilyFeudRoundSnapshot {
  number: number;
  total: number;
  activeTeamId: FamilyFeudTeamId;
  cardId: string;
  deckId?: string;
  deckName?: string;
  cardLocked: boolean;
  candidatePosition?: number;
  candidateTotal?: number;
  prompt?: string;
  answers: FamilyFeudAnswerSnapshot[];
  houseAnswers: FamilyFeudHouseAnswerSnapshot[];
  faceoffTeamId: FamilyFeudTeamId | null;
  faceoffAttemptedTeamIds: FamilyFeudTeamId[];
  phaseStartedAt: number;
  phaseEndsAt: number;
  paused: boolean;
  pausedRemainingMs: number;
}

export interface FamilyFeudClaimDisplay {
  sessionId: string;
  teamId: FamilyFeudTeamId;
  teamName: string;
  points: number;
  claimed: number;
  maximumClaims: number;
  claimUrl: string;
  expiresAt: number;
}

export interface FamilyFeudCue {
  id: string;
  kind: "buzz" | "open" | "correct" | "miss" | "timer" | "steal" | "victory";
  teamId?: FamilyFeudTeamId;
  points?: number;
}

export interface FamilyFeudSnapshot extends MultiplayerSequence {
  digest?: string;
  roomId: string;
  phase: FamilyFeudPhase;
  revision: number;
  serverNow: number;
  expiresAt: number;
  gameNumber: number;
  rounds: number;
  mainSeconds: number;
  stealSeconds: number;
  controllerConnected: boolean;
  eventScoring: boolean;
  teams: [FamilyFeudTeamSnapshot, FamilyFeudTeamSnapshot];
  round: FamilyFeudRoundSnapshot | null;
  winnerTeamIds: FamilyFeudTeamId[];
  resultConfirmed: boolean;
  claimDisplay: FamilyFeudClaimDisplay | null;
  cue: FamilyFeudCue | null;
}

export interface FamilyFeudRoomCredentials extends MultiplayerRoomLifetime {
  controllerPairingToken: string;
  presenterToken: string;
  /** Legacy shared-buzzer credential retained for existing links and recovery. */
  buzzerToken: string;
  buzzerTokens: Record<FamilyFeudTeamId, string>;
}

export type FamilyFeudRoomErrorCode = "room_unavailable" | "card_unavailable";
export type FamilyFeudRejectionCode =
  | FamilyFeudRoomErrorCode
  | "action_unavailable"
  | "answer_unavailable"
  | "already_revealed"
  | "buzzers_closed"
  | "result_confirmed";

export type FamilyFeudControllerAction = MultiplayerAction &
  (
    | { type: "game.start" }
    | { type: "phase.advance" }
    | { type: "card.skip" | "card.next" | "card.previous" | "card.use" | "round.replace" }
    | { type: "faceoff.open" }
    | { type: "faceoff.claim"; teamId: FamilyFeudTeamId }
    | { type: "faceoff.miss" }
    | { type: "answer.reveal"; answerId: string }
    | { type: "answer.hide"; answerId: string }
    | { type: "answer.reassign"; answerId: string; teamId: FamilyFeudTeamId }
    | { type: "steal.miss" }
    | { type: "timer.pause" | "timer.resume" | "timer.reset" }
    | { type: "score.adjust"; teamId: FamilyFeudTeamId; points: number }
    | { type: "house-answer.add"; label: string; teamId?: FamilyFeudTeamId }
    | { type: "undo.last" }
    | { type: "result.confirm" }
    | { type: "claim.display"; display: FamilyFeudClaimDisplay | null }
    | { type: "game.replay" | "game.end" | "sudden-death.start" }
  );

export type FamilyFeudBuzzerAction = MultiplayerAction & {
  type: "buzzer.hit";
  teamId: FamilyFeudTeamId;
};

export type FamilyFeudSnapshotResult =
  | MultiplayerSuccess<{ unchanged?: false; snapshot: FamilyFeudSnapshot }>
  | MultiplayerSuccess<{ unchanged: true; serverNow: number; snapshot: null }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type FamilyFeudActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: FamilyFeudSnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      snapshot: FamilyFeudSnapshot;
      errorCode: FamilyFeudRejectionCode;
      error: string;
    }>
  | (MultiplayerFailure<FamilyFeudRoomErrorCode> & {
      accepted: false;
      snapshot: null;
    });
