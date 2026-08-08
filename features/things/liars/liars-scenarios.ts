import type { LiarsLineup, LiarsMode, LiarsRole, LiarsToggles } from "./types";

/**
 * Named starting positions, for the dev harness and for tests.
 *
 * A capture (§5.13) freezes a room you happened to reach. A scenario is the opposite: a description
 * of a position worth reaching on purpose, built from the outside. Every awkward corner of the
 * rules gets one, so "what happens when the bodyguard and the doctor both cover the same person"
 * is one tap rather than a lucky deal.
 */
export interface LiarsScenario {
  id: string;
  name: string;
  /** What this position is for — the thing you are trying to look at. */
  about: string;
  mode: LiarsMode;
  players: number;
  lineup?: LiarsLineup;
  toggles?: Partial<LiarsToggles>;
  /** Seat index to role, for the deals that need to be exact rather than random. */
  deal?: Record<number, LiarsRole>;
}

export const LIARS_SCENARIOS: LiarsScenario[] = [
  {
    id: "smallest-mafia",
    name: "the smallest game",
    about: "Five players, one mafia. The floor of the ruleset, where a single wrong vote ends it.",
    mode: "mafia",
    players: 5,
  },
  {
    id: "doctor-self-save",
    name: "doctor saves themselves",
    about:
      "The mafia go for the doctor and the doctor is covering their own door. Checks the revive beat and the no-repeat rule that follows it.",
    mode: "mafia",
    players: 5,
    deal: { 0: "mafia", 1: "doctor", 2: "detective", 3: "villager", 4: "villager" },
  },
  {
    id: "bodyguard-substitution",
    name: "bodyguard takes the hit",
    about:
      "Somebody still dies, and it is not the person the mafia chose. The two-stage dawn: the target falls, holds, and then the guard is named instead.",
    mode: "mafia",
    players: 11,
  },
  {
    id: "escort-testimony",
    name: "escort dies a witness",
    about:
      "The escort spends the night where the mafia are going. They die with them, and their report publishes at dawn as testimony.",
    mode: "mafia",
    players: 11,
  },
  {
    id: "godfather-overrules",
    name: "the mafia disagree",
    about:
      "Two mafia pick different people. The godfather's choice happens, both count as having moved, and the town can see neither.",
    mode: "mafia",
    players: 9,
  },
  {
    id: "corroborated-watch",
    name: "two watchers, one door",
    about:
      "The threshold that makes watch work. One watcher learns something unprovable; two make it public at dawn without naming themselves.",
    mode: "mafia",
    players: 9,
  },
  {
    id: "graveyard-armed",
    name: "the graveyard votes",
    about:
      "Half the table is gone, so the dead get their one collective ballot. The endgame this mechanic exists for.",
    mode: "mafia",
    players: 9,
  },
  {
    id: "jester-wins",
    name: "the jester gets ejected",
    about: "The game ends outright, mid-arc, and one person wins alone.",
    mode: "mafia",
    players: 9,
  },
  {
    id: "jammed-doctor",
    name: "the jammer blocks the doctor",
    about:
      "The save never happens, the doctor is told their night was interrupted, and they still register as having gone out.",
    mode: "mafia",
    players: 12,
  },
  {
    id: "vigilante-guilt",
    name: "vigilante shoots the wrong person",
    about: "A townsperson dies to the town, and the vigilante dies of guilt the following night.",
    mode: "mafia",
    players: 14,
  },
  {
    id: "full-house",
    name: "everything at once",
    about:
      "Sixteen players and every role in the game. Mostly here to see whether the day is still readable at that size — it is the lineup most likely to be too much.",
    mode: "mafia",
    players: 16,
  },
  {
    id: "first-game",
    name: "nobody has played before",
    about: "Doctor, detective and villagers only, with the longer deal. What a new group actually sees.",
    mode: "mafia",
    players: 9,
    toggles: { firstGame: true },
  },
  {
    id: "quiet-night",
    name: "the mafia stay in",
    about: "Nobody dies and nobody moves. Checks that a silent night reads as ambiguous rather than broken.",
    mode: "mafia",
    players: 9,
  },
  {
    id: "imposter-smallest",
    name: "imposter, four players",
    about: "One imposter, three crew, and almost nothing to hide behind.",
    mode: "imposter",
    players: 4,
  },
  {
    id: "imposter-understudy",
    name: "the understudy",
    about:
      "Someone has the wrong word and does not know it. The role that makes a strange clue genuinely ambiguous.",
    mode: "imposter",
    players: 8,
  },
  {
    id: "imposter-final-guess",
    name: "caught, and guesses right",
    about: "The crew vote correctly and lose anyway. The beat that makes the vote worth being tense about.",
    mode: "imposter",
    players: 6,
  },
  {
    id: "imposter-mole",
    name: "imposter and mole",
    about: "A crew member with the real word playing for the other side, whom the imposter cannot see.",
    mode: "imposter",
    players: 12,
  },
  {
    id: "imposter-blind",
    name: "two blind imposters",
    about: "Two imposters who do not know each other, each assuming the other is crew.",
    mode: "imposter",
    players: 12,
    toggles: { blindImposters: true },
  },
];
