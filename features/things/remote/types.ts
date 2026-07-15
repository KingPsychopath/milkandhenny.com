export type RemoteGameKind = "heads-up" | "spelling-bee";

export type RemoteResultDecision = "correct" | "incorrect" | "pass";

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
  paused: boolean;
  pauseReason?: string;
  score: number;
  results: RemoteResultItem[];
  transcript?: string;
  updatedAt: number;
}

export type RemoteCommand =
  | { id: string; type: "correct" | "incorrect" | "pass" | "pause" | "resume" | "undo"; createdAt: number }
  | {
      id: string;
      type: "amend";
      resultId: string;
      decision: RemoteResultDecision;
      createdAt: number;
    };

export interface RemoteRoomCredentials {
  roomId: string;
  hostToken: string;
  judgeToken: string;
  expiresAt: number;
}

export interface RemoteHostSyncResult {
  ok: boolean;
  commands: RemoteCommand[];
  judgeConnected: boolean;
  error?: string;
}

export interface RemoteJudgeSnapshotResult {
  ok: boolean;
  snapshot: RemoteGameSnapshot | null;
  hostConnected: boolean;
  expiresAt: number | null;
  error?: string;
}
