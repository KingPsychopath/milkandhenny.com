import { randomInt } from "node:crypto";

import { LIARS_WORD_PAIRS, type LiarsWordPair } from "./liars-words";

/**
 * Narration, and the server's view of the word bank.
 *
 * The narration template is chosen here so every device tells the same story rather than each
 * picking its own. The word list itself lives in `liars-words.ts` and is browser-safe — it is not a
 * secret, and the one-phone mode needs it without a server. What must never reach the wrong client
 * is the word that was *dealt*, and that is the snapshot's job.
 */

export { LIARS_WORD_PAIRS, type LiarsWordPair };

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
 * `{victim}`, `{ejected}` and `{substitute}` are filled in by the engine.
 *
 * Kept to one short line each. The narration plays over a choreographed dawn with about seven
 * seconds of room, and on a phone a long sentence pushes the thing people actually need to read —
 * who died — off the first screen. There are enough of them that a five-round game should not
 * hear the same line twice; the engine also remembers the last dozen and avoids them.
 */
const NARRATION: Record<NarrationOutcome, string[]> = {
  killed: [
    "The milk was still on {victim}'s step.",
    "{victim} did not make it to morning.",
    "Someone came for {victim} and left the door open.",
    "The town woke up one short. It was {victim}.",
    "{victim} slept through it. All of it.",
    "There was frost on the windows and {victim} underneath it.",
    "Whoever took {victim} walked home the long way.",
    "{victim} had been saying they slept badly.",
    "Nobody heard {victim} go.",
    "They found {victim} before the kettle boiled.",
    "{victim}'s light was on all night. {victim} was not.",
    "It was quick, and it was {victim}.",
    "The dogs stayed quiet. {victim} did not wake up.",
    "{victim} is gone, and the street looks the same.",
    "Somebody knew exactly which door was {victim}'s.",
    "{victim} never locked it. Nobody here does.",
  ],
  saved: [
    "They came for {victim}. Somebody got there first.",
    "{victim} should not have seen this morning.",
    "There was blood on {victim}'s step and none of it mattered.",
    "{victim} woke up owing somebody a great deal.",
    "Someone was already sitting with {victim} when they arrived.",
    "{victim} was chosen. {victim} is still here.",
    "It nearly took {victim}. It very nearly did.",
  ],
  "nobody-died": [
    "Nothing happened. That is its own kind of news.",
    "The whole town slept, which nobody quite believes.",
    "No door opened. Everyone is still here.",
    "A quiet night. Somebody chose to make it one.",
    "Morning came and took nobody with it.",
    "Not a sound. Draw from that what you like.",
  ],
  bodyguard: [
    "They came for {victim}. {substitute} stepped in front.",
    "{substitute} had been at {victim}'s door all night.",
    "It should have been {victim}. {substitute} saw to that.",
    "{substitute} died where {victim} was meant to.",
  ],
  "ejected-guilty": [
    "They took {ejected} to the square, and they were right.",
    "{ejected} talked the whole way. It did not help.",
    "Right about {ejected}. They will not always be.",
    "{ejected} ran out of story before they ran out of road.",
    "The town got one. The town got {ejected}.",
  ],
  "ejected-innocent": [
    "They took {ejected}, who had never hurt anyone.",
    "{ejected} said they were innocent. {ejected} was.",
    "Everyone agreed about {ejected}. Everyone was wrong.",
    "{ejected} went quietly. That was the worst of it.",
    "One fewer of you, and none of them.",
  ],
  tie: [
    "The town argued until dark and agreed on nothing.",
    "No majority. Everybody goes home.",
    "The vote split clean down the middle.",
    "Nobody could carry the square today.",
  ],
  left: ["{victim} left town in the night."],
};

export interface LiarsNarrationLine {
  /** Stable enough to remember and avoid, without storing the whole sentence. */
  id: string;
  text: string;
}

export function liarsNarration(
  outcome: NarrationOutcome,
  slots: { victim?: string; ejected?: string; substitute?: string },
  recentIds: string[] = [],
): LiarsNarrationLine {
  const templates = NARRATION[outcome];
  const fresh = templates
    .map((template, index) => ({ template, id: `${outcome}:${index}` }))
    .filter(({ id }) => !recentIds.includes(id));
  const pool = fresh.length > 0 ? fresh : templates.map((template, index) => ({ template, id: `${outcome}:${index}` }));
  const chosen = pool[randomInt(pool.length)];
  return {
    id: chosen.id,
    text: chosen.template
      .replaceAll("{victim}", slots.victim ?? "someone")
      .replaceAll("{ejected}", slots.ejected ?? "someone")
      .replaceAll("{substitute}", slots.substitute ?? "someone"),
  };
}
