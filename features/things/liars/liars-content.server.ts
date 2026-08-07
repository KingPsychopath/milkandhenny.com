import { randomInt } from "node:crypto";

/**
 * Narration and word content. Server-only: the imposter's word must never reach a client that is
 * not entitled to it, and the narration template is chosen here so every device tells the same
 * story rather than each picking its own.
 */

export interface LiarsWordPair {
  /** What the crew are given. */
  word: string;
  /** What the understudy is given — close enough to survive a round, wrong enough to surface. */
  decoy: string;
}

/**
 * The pairing is the whole mechanic. Too far apart and the understudy is obvious on their first
 * clue; too close and the role is indistinguishable from a crew member and nobody can win. Each of
 * these shares a first association and diverges on the second or third.
 */
export const LIARS_WORD_PAIRS: LiarsWordPair[] = [
  { word: "beach", decoy: "desert" },
  { word: "library", decoy: "museum" },
  { word: "hospital", decoy: "school" },
  { word: "wedding", decoy: "funeral" },
  { word: "airport", decoy: "train station" },
  { word: "cinema", decoy: "theatre" },
  { word: "guitar", decoy: "piano" },
  { word: "coffee", decoy: "tea" },
  { word: "winter", decoy: "autumn" },
  { word: "volcano", decoy: "mountain" },
  { word: "pirate", decoy: "viking" },
  { word: "dentist", decoy: "barber" },
  { word: "prison", decoy: "boarding school" },
  { word: "circus", decoy: "carnival" },
  { word: "submarine", decoy: "spaceship" },
  { word: "vampire", decoy: "ghost" },
  { word: "marathon", decoy: "triathlon" },
  { word: "casino", decoy: "arcade" },
  { word: "farm", decoy: "zoo" },
  { word: "bakery", decoy: "butcher" },
  { word: "lighthouse", decoy: "windmill" },
  { word: "aquarium", decoy: "greenhouse" },
  { word: "snow", decoy: "sand" },
  { word: "detective", decoy: "journalist" },
  { word: "campfire", decoy: "fireplace" },
  { word: "helicopter", decoy: "hot air balloon" },
  { word: "supermarket", decoy: "market stall" },
  { word: "swimming pool", decoy: "lake" },
  { word: "birthday", decoy: "anniversary" },
  { word: "chess", decoy: "poker" },
  { word: "umbrella", decoy: "raincoat" },
  { word: "castle", decoy: "cathedral" },
  { word: "orchestra", decoy: "choir" },
  { word: "desert island", decoy: "shipwreck" },
  { word: "laundry", decoy: "dishwashing" },
  { word: "haircut", decoy: "tattoo" },
  { word: "earthquake", decoy: "thunderstorm" },
  { word: "honeymoon", decoy: "road trip" },
  { word: "bicycle", decoy: "motorbike" },
  { word: "greenhouse", decoy: "allotment" },
  { word: "opera", decoy: "ballet" },
  { word: "safari", decoy: "hiking" },
  { word: "post office", decoy: "bank" },
  { word: "graveyard", decoy: "battlefield" },
];

export function liarsWordPair(recentWords: string[] = []): LiarsWordPair {
  const fresh = LIARS_WORD_PAIRS.filter(({ word }) => !recentWords.includes(word));
  const pool = fresh.length > 0 ? fresh : LIARS_WORD_PAIRS;
  return pool[randomInt(pool.length)];
}

type NarrationOutcome =
  | "killed"
  | "saved"
  | "nobody-died"
  | "bodyguard"
  | "ejected-guilty"
  | "ejected-innocent"
  | "tie"
  | "left";

/**
 * `{victim}`, `{ejected}`, `{saviour}` and `{substitute}` are filled in by the engine. Templates
 * stay short: the narration plays over a choreographed dawn and has about seven seconds of room.
 */
const NARRATION: Record<NarrationOutcome, string[]> = {
  killed: [
    "It was a beautiful morning, right up until somebody looked in on {victim}.",
    "The milk was still on the step outside {victim}'s door. Nobody had taken it in.",
    "{victim} had been telling everyone they slept badly. Last night they slept through it.",
    "Someone came for {victim} in the dark, and left the door open behind them.",
    "The town woke up one person short. That person was {victim}.",
    "There was frost on the windows and {victim} was cold underneath it.",
    "{victim} never made it to morning, and whoever did it walked home the long way.",
    "The dogs were quiet all night. In the morning, {victim} was quieter.",
  ],
  saved: [
    "They came for {victim}. Somebody got there first.",
    "{victim} should not have seen this morning. Somebody made sure they did.",
    "There was blood on {victim}'s doorstep and none of it mattered in the end.",
    "{victim} woke up owing somebody a very large favour.",
  ],
  "nobody-died": [
    "Nothing happened last night. That is its own kind of news.",
    "The whole town slept, which nobody quite believes.",
    "No door opened, no dog barked, nobody screamed. Everyone is still here.",
    "A quiet night. Somebody chose to make it one.",
  ],
  bodyguard: [
    "They came for {victim}. {substitute} stepped in front of them.",
    "{substitute} had been standing outside {victim}'s door all night. That turned out to matter.",
    "It should have been {victim}. {substitute} made sure it was not.",
  ],
  "ejected-guilty": [
    "The town took {ejected} out to the square, and for once they had the right person.",
    "{ejected} kept talking the whole way. It did not help.",
    "They were right about {ejected}. They will not always be.",
  ],
  "ejected-innocent": [
    "The town took {ejected} out to the square. {ejected} had never hurt anyone.",
    "{ejected} said they were innocent. {ejected} was innocent.",
    "Everyone agreed about {ejected}. Everyone was wrong.",
  ],
  tie: [
    "The town argued until dark and could not agree on anything.",
    "Nobody could get a majority. Everybody goes home.",
    "The vote split clean down the middle, and the square emptied out.",
  ],
  left: ["{victim} left town in the night and did not say goodbye."],
};

export function liarsNarration(
  outcome: NarrationOutcome,
  slots: { victim?: string; ejected?: string; substitute?: string },
) {
  const templates = NARRATION[outcome];
  const template = templates[randomInt(templates.length)];
  return template
    .replaceAll("{victim}", slots.victim ?? "someone")
    .replaceAll("{ejected}", slots.ejected ?? "someone")
    .replaceAll("{substitute}", slots.substitute ?? "someone");
}
