export const OFFICIAL_GAME_KINDS = [
  "centre",
  "twin",
  "draw-country",
  "same-brain",
  "spelling-party",
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
