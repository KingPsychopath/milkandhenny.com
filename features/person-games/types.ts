export type PersonGameMode = "daily" | "room" | "event";
export type PersonGameStatus = "active" | "completed" | "abandoned";

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
}
