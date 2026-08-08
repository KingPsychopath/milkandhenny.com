import type { SameBrainScoring, SameBrainTimings, SameBrainToggles } from "./types";

/**
 * Named starting positions, for the dev harness and for tests.
 *
 * This game's awkward corners are all in the scoring, and almost none of them turn up by chance —
 * you cannot get five people to type "sea", "ocean" and "the sea" on purpose while also watching
 * what the reveal does with it. So each scenario carries the answers as well as the setup: the
 * harness fills them in, the round scores for real, and the same list is walked by the integration
 * tests.
 *
 * `answers` is seat index to what that seat types. Seats with no entry answer nothing, which is its
 * own case worth having.
 */
export interface SameBrainScenario {
  id: string;
  name: string;
  /** What this position is for — the thing you are trying to look at. */
  about: string;
  players: number;
  scoring?: SameBrainScoring;
  toggles?: Partial<SameBrainToggles>;
  /**
   * Overrides the harness's short phases. Only needed by scenarios that are *about* a countdown: a
   * seven-second beat is over before you can look at it across four panels.
   */
  timings?: Partial<SameBrainTimings>;
  question?: string;
  answers?: Record<number, string>;
  /** What should happen, in a sentence. Asserted loosely by the tests and read by a human here. */
  expect: string;
}

export const SAME_BRAIN_SCENARIOS: SameBrainScenario[] = [
  {
    id: "clean-majority",
    name: "a clean herd",
    about:
      "Four of six agree outright, two do not. The ordinary round, and the shape everything else deviates from.",
    players: 6,
    question: "Name something in a kitchen drawer",
    answers: { 0: "spoon", 1: "spoon", 2: "spoon", 3: "spoon", 4: "knife", 5: "scissors" },
    expect:
      "the spoon group scores two each; nobody is the odd one, because two people stood apart",
  },
  {
    id: "odd-one-out",
    name: "one person alone",
    about:
      "Five agree and one does not. The only shape that produces an odd one out, and what the house rule acts on.",
    players: 6,
    question: "Name something cold",
    answers: { 0: "ice", 1: "ice", 2: "ice", 3: "ice", 4: "ice", 5: "breakup" },
    expect: "the ice group scores two each and the sixth player is named the odd one",
  },
  {
    id: "odd-one-eliminated",
    name: "the odd one is out for good",
    about:
      "The same position with the house rule on, which is the only way anybody leaves this game.",
    players: 6,
    scoring: "exact",
    toggles: { eliminateOddOne: true },
    question: "Name something cold",
    answers: { 0: "ice", 1: "ice", 2: "ice", 3: "ice", 4: "ice", 5: "breakup" },
    expect: "the sixth player is out and stops receiving a submit prompt",
  },
  {
    id: "spelling-split",
    name: "the same answer, three spellings",
    about:
      "The round the model exists for. Everybody meant the sea; nobody typed the same string. On exact matches this is a dead round, and switching the method mid-scenario shows the difference in one tap.",
    players: 5,
    question: "Name somewhere you would not swim",
    answers: { 0: "the sea", 1: "sea", 2: "ocean", 3: "canal", 4: "river" },
    expect:
      "exact: nothing scores except the sea/the sea pair. embedding: sea, the sea and ocean form one herd of three",
  },
  {
    id: "punctuation-only",
    name: "punctuation is not disagreement",
    about:
      "Answers that differ by an apostrophe, a capital, an article and a hyphen. All handled before the model is asked, and a regression here would quietly break every round.",
    players: 5,
    scoring: "exact",
    question: "Name something people put on toast",
    answers: { 0: "Butter", 1: "butter.", 2: "the butter", 3: " BUTTER ", 4: "jam" },
    expect: "one herd of four on exact matches alone, with no model involved",
  },
  {
    id: "dead-split",
    name: "the room splits down the middle",
    about:
      "Two groups of three. Nobody scores, and the reveal has to make that feel like a result rather than a bug.",
    players: 6,
    question: "Name a topping people argue about",
    answers: {
      0: "pineapple",
      1: "pineapple",
      2: "pineapple",
      3: "anchovy",
      4: "anchovy",
      5: "anchovy",
    },
    expect: "no herd, nobody scores, noScoreReason is split",
  },
  {
    id: "all-alone",
    name: "six answers, six people",
    about:
      "No two people agreed on anything. The floor of the game — worth checking it reads as a shrug, not an error.",
    players: 6,
    question: "Name a job you would be terrible at",
    answers: { 0: "surgeon", 1: "pilot", 2: "teacher", 3: "chef", 4: "plumber", 5: "actuary" },
    expect: "no herd, nobody scores, and nobody is the odd one either",
  },
  {
    id: "unanimous",
    name: "everybody said the same thing",
    about:
      "The bland equilibrium, deliberately reached. Pays one point rather than two, which is the only thing stopping the whole game becoming this.",
    players: 5,
    question: "Name something in a toolbox",
    answers: { 0: "hammer", 1: "hammer", 2: "hammer", 3: "hammer", 4: "hammer" },
    expect: "everyone scores one, not two",
  },
  {
    id: "missing-answers",
    name: "two people never answered",
    about:
      "Phones down, submit times out. The round has to score on who did answer rather than waiting or voiding.",
    players: 6,
    question: "Name a reason someone is late",
    answers: { 0: "traffic", 1: "traffic", 2: "traffic", 3: "overslept" },
    expect:
      "scores on the four submitted answers; the two silent players simply do not appear in a cluster",
  },
  {
    id: "three-players",
    name: "the smallest game",
    about:
      "Three players, where any two agreeing is a herd and the third is automatically the odd one.",
    players: 3,
    question: "Name something you always lose",
    answers: { 0: "keys", 1: "keys", 2: "socks" },
    expect: "the pair scores two each and the third is the odd one",
  },
  {
    id: "say-it-aloud",
    name: "saying it out loud",
    about:
      "The spoken beat, stretched out so you can watch it. Every panel counts down to the same moment and then shows only its own word — check that the four countdowns move together and that no panel shows anybody else's answer.",
    players: 4,
    scoring: "exact",
    toggles: { sayItAloud: true },
    // Twenty seconds of countdown and four of hold, rather than three and four.
    timings: { sayIt: 20_000 },
    question: "Name something you only eat at Christmas",
    answers: { 0: "turkey", 1: "turkey", 2: "sprouts", 3: "the turkey" },
    expect:
      "all four count down in step, each sees only its own word, then a herd of three on turkey",
  },
  {
    id: "long-game",
    name: "a full game to the ending",
    about:
      "Three rounds to the final scores, for looking at the scoreboard and the winner copy rather than one round.",
    players: 5,
    expect: "reaches the ending phase with a ranked scoreboard and at least one winner",
  },
];
