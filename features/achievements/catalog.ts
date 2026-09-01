import type { AchievementDefinition, AchievementKey } from "./types";

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    key: "present",
    scope: "event",
    title: "Present!",
    description: "Check in to the event.",
    icon: "door",
  },
  {
    key: "found-something",
    scope: "event",
    title: "Found Something",
    description: "Find and claim your first hunt clue.",
    icon: "search",
  },
  {
    key: "leave-no-trace",
    scope: "event",
    title: "Leave No Trace",
    description: "Find every hunt clue at this event.",
    icon: "map",
  },
  {
    key: "game-night-graduate",
    scope: "event",
    title: "Game Night Graduate",
    description: "Complete three different scored activities.",
    icon: "dice",
  },
  {
    key: "four-corners",
    scope: "event",
    title: "Four Corners",
    description: "Play every app pool game available at this event.",
    icon: "grid",
  },
  {
    key: "full-house",
    scope: "event",
    title: "Full House",
    description: "Complete the event bingo and have it verified.",
    icon: "bingo",
  },
  {
    key: "spellbound",
    scope: "event",
    title: "Spellbound",
    description: "Take part in the spelling bee.",
    icon: "letters",
  },
  {
    key: "six-appeal",
    scope: "global",
    title: "Six Appeal",
    description: "Publish a pitch with exactly six non-empty slides.",
    icon: "slides",
  },
  {
    key: "regular-behaviour",
    scope: "series",
    title: "Regular Behaviour",
    description: "Check in to three different Milk & Henny events.",
    icon: "calendar",
  },
] as const;

const BY_KEY = new Map(ACHIEVEMENTS.map((achievement) => [achievement.key, achievement]));

export function achievementDefinition(key: string): AchievementDefinition | undefined {
  return BY_KEY.get(key as AchievementKey);
}
