// The games whose room engines emit official results for event scoring. This is deliberately
// narrower than GAME_SETTINGS_GAMES: liars and hot-and-cold have settings but no official
// results yet, and spelling-party emits results without configurable settings.
export const OFFICIAL_GAME_KINDS = [
  "centre",
  "twin",
  "draw-country",
  "same-brain",
  "spelling-party",
  "liars",
  "pitches",
  "heads-up",
  "spelling-bee",
  "icebreaker",
] as const;

export type OfficialGameKind = (typeof OFFICIAL_GAME_KINDS)[number];
export type OfficialGameResultScope = "round" | "match" | "game";

export type OfficialResultPlayer = {
  playerId: string;
  outcome: "completed" | "did-not-finish" | "withdrawn" | "disqualified";
  rawScore?: number;
  placement?: number;
  durationMs?: number;
  won?: boolean;
};

export type OfficialGameResultDraft = {
  gameKind: OfficialGameKind;
  gameInstanceId: string;
  resultId: string;
  scope: OfficialGameResultScope;
  players: OfficialResultPlayer[];
};

export type OfficialGameResultEnvelope = OfficialGameResultDraft & {
  schemaVersion: 1;
  channelId: string;
  revision: number;
  operation: "record" | "cancel";
  committedAt: string;
  payloadHash: string;
};

export type OfficialResultEmitter = {
  record(result: OfficialGameResultDraft): void;
  correct(result: OfficialGameResultDraft): void;
  cancel(result: Omit<OfficialGameResultDraft, "players">): void;
};
