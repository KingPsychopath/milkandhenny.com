export const ACHIEVEMENT_KEYS = [
  "present",
  "found-something",
  "leave-no-trace",
  "game-night-graduate",
  "four-corners",
  "full-house",
  "spellbound",
  "six-appeal",
  "regular-behaviour",
] as const;

export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[number];
export type AchievementScope = "event" | "series" | "global";
export type AchievementIconKey =
  | "door"
  | "search"
  | "map"
  | "dice"
  | "grid"
  | "bingo"
  | "letters"
  | "slides"
  | "calendar";

export type AchievementDefinition = {
  key: AchievementKey;
  scope: AchievementScope;
  title: string;
  description: string;
  icon: AchievementIconKey;
  rewardPoints?: number;
  secret?: boolean;
};

export type AchievementProgress = AchievementDefinition & {
  current: number;
  target: number;
  unlockedAt?: string;
  eventSlug?: string;
};

export type AchievementView = {
  event: AchievementProgress[];
  permanent: AchievementProgress[];
  unlockedCount: number;
  totalCount: number;
};

export type AchievementNotification = AchievementDefinition & {
  id: string;
  eventSlug?: string;
  sourceTransactionId?: string;
  unlockedAt: string;
};
