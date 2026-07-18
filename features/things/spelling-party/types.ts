import type {
  MultiplayerAction,
  MultiplayerRevision,
  MultiplayerRoomIdentity,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
} from "../shared/multiplayer";

export type PartyPhase = "lobby" | "countdown" | "answer" | "locked" | "reveal" | "finished";
export type PartyRole = "presenter" | "player";
export type PartyClueKind = "repeat" | "definition" | "sentence";
export const PARTY_REVEAL_COOLDOWN_MS = 8_000;

export interface PartyDeckSummary {
  id: string;
  name: string;
  description: string;
  symbol: string;
  wordCount: number;
}

export interface PartyCustomDeckInput {
  id: string;
  name: string;
  words: Array<{
    id: string;
    word: string;
    partOfSpeech?: string;
    definition?: string;
    speakAs?: string;
    sentence?: string;
  }>;
}

export interface PartyPlayerSummary {
  id: string;
  name: string;
  status: "ready" | "typing" | "locked" | "disconnected";
  score: number;
  connected: boolean;
  integrityNotices: number;
}

export interface PartyRevealAnswer {
  playerId: string;
  name: string;
  answer: string;
  correct: boolean;
  automatic: boolean;
  lockedAt: number;
  distance: number;
  similarity: number;
  place: number;
}

export interface PartyClueEvent {
  id: string;
  kind: PartyClueKind;
  playerName: string;
  message: string;
  createdAt: number;
  audioUrl: string | null;
  speechText?: string;
}

export interface PartyRoundSnapshot {
  roundId: string;
  number: number;
  total: number;
  countdownStartsAt: number;
  audioPlaysAt: number;
  answerOpensAt: number;
  answerLocksAt: number;
  revealAt: number;
  nextRoundAt: number | null;
  wordAudioUrl: string | null;
  spokenWord?: string;
  speechLocale?: "en-GB" | "en-US";
  activeClue: PartyClueEvent | null;
  repeatUsed: boolean;
  definitionUsed: boolean;
  sentenceCluesRemaining: number;
  correctWord?: string;
  answers?: PartyRevealAnswer[];
}

export interface PartyPlayerPrivateState {
  draft: string;
  draftRevision: number;
  locked: boolean;
  lockedAutomatically: boolean;
}

export interface PartySnapshot extends MultiplayerRoomIdentity, MultiplayerRevision, MultiplayerSequence {
  deckName: string;
  phase: PartyPhase;
  serverNow: number;
  answerSeconds: number;
  players: PartyPlayerSummary[];
  round: PartyRoundSnapshot | null;
  recentClues: PartyClueEvent[];
  player: PartyPlayerPrivateState | null;
}

export interface PartyRoomCredentials extends MultiplayerRoomLifetime {
  presenterToken: string;
  joinToken: string;
  selectedWordIds: string[];
}

export interface PartyPlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  presenterToken?: string;
  snapshot: PartySnapshot;
}

export interface PartySnapshotResult {
  ok: boolean;
  snapshot: PartySnapshot | null;
  error?: string;
}

export type PartyPresenterAction = MultiplayerAction & {
  type: "round.start" | "round.next" | "round.pause" | "round.resume";
};

export type PartyPlayerAction = MultiplayerAction & (
  | {
      type: "draft.update";
      roundId: string;
      draft: string;
      draftRevision: number;
    }
  | { type: "answer.lock"; roundId: string }
  | { type: "clue.request"; roundId: string; clue: PartyClueKind }
  | { type: "integrity.notice"; roundId: string; hiddenMs: number }
);

export interface PartyActionResult extends PartySnapshotResult {
  accepted: boolean;
}
