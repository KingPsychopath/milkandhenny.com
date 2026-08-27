export type PersonGameMode = "daily" | "solo" | "room" | "event";
export type PersonGameStatus = "active" | "completed" | "abandoned";
export type PersonGameMetadata = Record<string, boolean | number | string | null>;

export interface PersonGameHistoryItem {
  id: string;
  game: string;
  mode: PersonGameMode;
  reference: string;
  displayName?: string;
  status: PersonGameStatus;
  outcome?: string;
  score?: number;
  startedAt: string;
  lastPlayedAt: string;
  completedAt?: string;
  eventCount: number;
  summary: PersonGameMetadata;
}

export interface PersonGameStats {
  game: string;
  plays: number;
  completed: number;
  wins: number;
  actions: number;
  lastPlayedAt: string;
  guesses?: number;
  hints?: number;
  hotGuesses?: number;
  coldGuesses?: number;
  bestRank?: number;
}
