import { TWIN_TIMING } from "./twin-rules";

/**
 * Named starting positions, for the dev harness and for the integration tests.
 *
 * Twin's awkward corners are configurations rather than deals — a heat nobody can win, a table big
 * enough that the deck has to shrink the hand, a hand short enough that the ending arrives on the third
 * heat. Each of these is one tap instead of a lucky shuffle.
 */
export interface TwinScenario {
  id: string;
  name: string;
  /** What this position is for — the thing you are trying to look at. */
  about: string;
  players: number;
  handSize: number;
  windowMs?: number;
  graceMs?: number;
  /** Bots tap correctly this often. Below 1 they start missing, which is how a burn happens. */
  botAccuracy?: number;
}

export const TWIN_SCENARIOS: TwinScenario[] = [
  {
    id: "smallest",
    name: "the smallest game",
    about: "Two players, three cards each. The ending arrives almost immediately.",
    players: 2,
    handSize: 3,
  },
  {
    id: "standard",
    name: "a normal game",
    about: "Four players at the default hand. What most people will actually play.",
    players: 4,
    handSize: 6,
  },
  {
    id: "deck-shrinks",
    name: "the deck shrinks the hand",
    about:
      "Six players asking for six cards each needs 37 cards and only 31 are drawn, so the hand comes back as five. The sizing rule, visible in the lobby.",
    players: 6,
    handSize: 6,
  },
  {
    id: "full-table",
    name: "as many as it seats",
    about:
      "Ten players at the shortest hand — the ceiling of this build. Mostly here to see whether the settle list is still readable at that size.",
    players: 10,
    handSize: 3,
  },
  {
    id: "burn",
    name: "nobody finds it",
    about:
      "A window too short to solve, so the heat burns: the middle card stays and every hand turns over. The deadlock rule.",
    players: 4,
    handSize: 5,
    windowMs: TWIN_TIMING.minWindowMs,
    botAccuracy: 0,
  },
  {
    id: "photo-finish",
    name: "first blood, then the grace",
    about:
      "A long window and a short grace, so one fast player ends the heat for everybody. The rule that gives the round its tempo.",
    players: 5,
    handSize: 5,
    windowMs: TWIN_TIMING.maxWindowMs,
    graceMs: TWIN_TIMING.minGraceMs,
  },
  {
    id: "sloppy",
    name: "everyone is guessing",
    about:
      "Bots that miss half the time, so cooldowns stack up and the scattergun award has somebody to go to.",
    players: 4,
    handSize: 5,
    botAccuracy: 0.5,
  },
  {
    id: "alone",
    name: "one player",
    about: "A room of one. Every heat closes the moment they land it, and nothing divides by zero.",
    players: 1,
    handSize: 4,
  },
];
