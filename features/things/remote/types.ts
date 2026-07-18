import type {
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomLifetime,
  MultiplayerSuccess,
} from "../shared/multiplayer";

export type RemoteGameKind = "heads-up" | "spelling-bee";
export type PairedGameRoomRole = "player" | "judge";

export interface RemoteHeadsUpSetup {
  game: "heads-up";
  deck: {
    name: string;
    cards: string[];
  };
  positionLock: boolean;
}

export interface RemoteSpellingSetup {
  game: "spelling-bee";
  deck: {
    name: string;
    words: Array<{
      id: string;
      word: string;
      partOfSpeech?: string;
      definition?: string;
      speakAs?: string;
    }>;
  };
  timerSeconds: number;
  roundWordCount?: number;
  autoSpeak: boolean;
}

export type RemoteGameSetup = RemoteHeadsUpSetup | RemoteSpellingSetup;

export type RemoteResultDecision = "correct" | "incorrect" | "pass" | "skipped" | "timed_out";

export interface RemoteResultItem {
  id: string;
  label: string;
  decision: RemoteResultDecision;
  detail?: string;
}

export interface RemoteGameSnapshot {
  game: RemoteGameKind;
  phase: "setup" | "countdown" | "playing" | "results";
  deckName: string;
  currentLabel: string | null;
  currentDefinition?: string;
  currentPartOfSpeech?: string;
  nextLabel: string | null;
  secondsRemaining: number | null;
  /** Absolute player-authoritative deadline for the current item. */
  decisionClosesAt?: number;
  /** Short receipt-only window; the UI must not accept new decisions during it. */
  decisionGraceEndsAt?: number;
  paused: boolean;
  transitioning?: boolean;
  pauseReason?: string;
  score: number;
  results: RemoteResultItem[];
  transcript?: string;
  /** Stable local identity for the current card/word within a round. */
  itemKey?: string;
  updatedAt: number;
}

export interface RemoteCommandTarget {
  roundId: string;
  itemId: string;
}

export type RemoteCommandRequest = (
  | { id: string; type: "correct" | "incorrect" | "pass" | "skip" | "pause" | "resume" | "undo"; createdAt: number }
  | {
      id: string;
      type: "amend";
      resultId: string;
      decision: RemoteResultDecision;
      createdAt: number;
    }
) & RemoteCommandTarget;

export type RemoteCommand = RemoteCommandRequest & { sequence: number; receivedAt: number };

export type RemoteCommandReceiptReason =
  | "stale_round"
  | "stale_item"
  | "decision_closed"
  | "already_decided";

export interface RemoteCommandReceipt {
  commandId: string;
  sequence: number;
  status: "applied" | "rejected";
  reason?: RemoteCommandReceiptReason;
}

export interface RemoteSyncedSnapshot extends RemoteGameSnapshot, MultiplayerRevision {
  roundId: string | null;
  itemId: string | null;
  revision: number;
  connectionEpoch: string;
  commandReceipts: RemoteCommandReceipt[];
}

export interface PairedGameRoomCredentials extends MultiplayerRoomLifetime {
  playerToken: string;
  judgeToken: string;
  creatorRole: PairedGameRoomRole;
}

export interface RemotePlayerSession extends MultiplayerRoomLifetime {
  playerToken: string;
  connectionEpoch: string;
  setup: RemoteGameSetup;
}

export type PairedGameRoomErrorCode = "invite_expired" | "room_unavailable";
export type RemotePlayerSyncErrorCode =
  | PairedGameRoomErrorCode
  | "game_mismatch"
  | "player_conflict";
export type RemoteCommandErrorCode =
  | PairedGameRoomErrorCode
  | RemoteCommandReceiptReason
  | "command_expired"
  | "inactive_judge"
  | "stale_result"
  | "transitioning"
  | "rate_limited";

export type RemotePlayerSyncResult =
  | MultiplayerSuccess<{ commands: RemoteCommand[]; judgeConnected: boolean }>
  | (MultiplayerFailure<RemotePlayerSyncErrorCode> & {
      commands: [];
      judgeConnected: false;
    });

export type RemoteJudgeSnapshotResult =
  | MultiplayerSuccess<{
      snapshot: RemoteSyncedSnapshot | null;
      playerConnected: boolean;
      judgeActive: boolean;
      expiresAt: number;
    }>
  | (MultiplayerFailure<PairedGameRoomErrorCode> & {
      snapshot: null;
      playerConnected: false;
      judgeActive: false;
      expiresAt: null;
    });

export type RemoteTransportState = "connected" | "reconnecting" | "local";

export type RemotePlayerSetupResult =
  | MultiplayerSuccess<{
      setup: RemoteGameSetup;
      judgeConnected: boolean;
      expiresAt: number;
    }>
  | (MultiplayerFailure<PairedGameRoomErrorCode> & {
      setup: null;
      judgeConnected: false;
      expiresAt: null;
    });

export type RemoteCommandResult =
  | MultiplayerSuccess<{ sequence: number }>
  | MultiplayerFailure<RemoteCommandErrorCode>;
