export type PartyPhase = "lobby" | "countdown" | "answer" | "locked" | "reveal" | "finished";
export type PartyRole = "presenter" | "player";
export type PartyClueKind = "repeat" | "definition" | "sentence";

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

export interface PartySnapshot {
  roomId: string;
  deckName: string;
  phase: PartyPhase;
  revision: number;
  sequence: number;
  serverNow: number;
  answerSeconds: number;
  players: PartyPlayerSummary[];
  round: PartyRoundSnapshot | null;
  recentClues: PartyClueEvent[];
  player: PartyPlayerPrivateState | null;
}

export interface PartyRoomCredentials {
  roomId: string;
  presenterToken: string;
  joinToken: string;
  expiresAt: number;
  selectedWordIds: string[];
}

export interface PartyPlayerCredentials {
  roomId: string;
  playerId: string;
  playerToken: string;
  presenterToken?: string;
  expiresAt: number;
  snapshot: PartySnapshot;
}

export interface PartySnapshotResult {
  ok: boolean;
  snapshot: PartySnapshot | null;
  error?: string;
}

export type PartyPresenterAction =
  | { actionId: string; type: "round.start" }
  | { actionId: string; type: "round.next" };

export type PartyPlayerAction =
  | {
      actionId: string;
      type: "draft.update";
      roundId: string;
      draft: string;
      draftRevision: number;
    }
  | { actionId: string; type: "answer.lock"; roundId: string }
  | { actionId: string; type: "clue.request"; roundId: string; clue: PartyClueKind }
  | { actionId: string; type: "integrity.notice"; roundId: string; hiddenMs: number };

export interface PartyActionResult extends PartySnapshotResult {
  accepted: boolean;
}
