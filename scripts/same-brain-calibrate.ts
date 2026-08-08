#!/usr/bin/env tsx
/**
 * Does the scorer agree with a human?
 *
 * This is the only place the real model is run, and the only thing that can answer the question the
 * whole game rests on. The unit tests use a stub, because they are about the rules; this is about
 * whether `SAME_BRAIN_SIMILARITY_THRESHOLD` is the right number, and it is answered by sweeping the
 * threshold over hand-labelled rounds and counting three things:
 *
 *   hits    — rounds where the grouping matched the human label exactly
 *   merged  — pairs the model correctly joined that spelling alone would have split
 *   wrong   — pairs the model joined that a human would not have
 *
 * `wrong` is the number that decides. A missed merge only leaves a group to argue about whether
 * "sofa" and "settee" were the same answer, which they enjoy; a wrong merge invents a herd that
 * never existed and takes points off the people who actually agreed. So the threshold is chosen on
 * the merged-to-wrong ratio rather than the hit rate — a sweep that optimised hits would pick 0.65,
 * which merges surgeon with doctor.
 *
 * Zero wrong merges turns out not to be available: a few English words genuinely do sit on top of
 * each other, and the closed-set problem (Monday against Tuesday) is a content bug rather than a
 * threshold one. The bar is therefore five correct merges per mistake, and if no threshold clears it
 * the honest answer is to ship `exact` as the default and leave `embedding` as a house rule.
 *
 * Usage:
 *   pnpm calibrate:same-brain
 *   pnpm calibrate:same-brain --thresholds 0.6,0.65,0.7,0.75,0.8
 *   pnpm calibrate:same-brain --with-question   (embeds "question: answer" instead of "answer")
 */

import {
  SAME_BRAIN_SIMILARITY_THRESHOLD,
  clusterByExactMatch,
  normaliseAnswer,
  upgradeClusters,
} from "@/features/things/same-brain/same-brain-rules";
import type { SameBrainAnswer } from "@/features/things/same-brain/types";

interface Fixture {
  question: string;
  /** What each seat typed. */
  answers: string[];
  /**
   * How a reasonable person would group them, as groups of indices into `answers`. Singletons may be
   * omitted. This is the judgement the model is being measured against, and it was written before
   * any of these numbers were looked at.
   */
  groups: number[][];
  /** Why this round is in the fixture, when that is not obvious. */
  note?: string;
}

const FIXTURES: Fixture[] = [
  // --- The job the model exists for: one meaning, several spellings. ---
  {
    question: "Name somewhere you would not swim",
    answers: ["the sea", "sea", "ocean", "canal", "river"],
    groups: [[0, 1, 2]],
    note: "the motivating case",
  },
  {
    question: "Name something in a kitchen drawer",
    answers: ["knife", "knives", "cutlery", "spoon", "whisk"],
    groups: [[0, 1]],
    note: "cutlery is a category, not the same answer as knife — a merge here is wrong",
  },
  {
    question: "Name something you sit on",
    answers: ["sofa", "settee", "couch", "chair", "stool"],
    groups: [[0, 1, 2]],
    note: "three words for one object, and two other objects",
  },
  {
    question: "Name something in a bathroom cabinet",
    answers: ["plasters", "band aids", "paracetamol", "toothpaste"],
    groups: [[0, 1]],
  },
  {
    question: "Name something you keep in a shed",
    answers: ["bike", "bicycle", "lawnmower", "mower", "spade"],
    groups: [
      [0, 1],
      [2, 3],
    ],
    note: "two separate merges in one round",
  },
  {
    question: "Name something people put on toast",
    answers: ["butter", "Butter", "jam", "marmalade", "beans"],
    groups: [[0, 1]],
    note: "handled before the model is asked; here to prove the model does not then over-merge",
  },
  {
    question: "Name a drink that means the night is over",
    answers: ["water", "tap water", "tea", "coffee"],
    groups: [[0, 1]],
  },
  {
    question: "Name something you always lose",
    answers: ["keys", "house keys", "phone", "socks", "charger"],
    groups: [[0, 1]],
  },
  {
    question: "Name something loud",
    answers: ["drums", "drum kit", "siren", "alarm"],
    groups: [[0, 1]],
    note: "siren and alarm are close but not the same answer",
  },
  {
    question: "Name a job you would be terrible at",
    answers: ["surgeon", "doctor", "pilot", "teacher"],
    groups: [],
    note: "surgeon and doctor are related, not interchangeable — a classic wrong merge",
  },

  // --- Rounds where the axis of the question is not the axis of the embedding. ---
  {
    question: "Name something cold",
    answers: ["ice", "snow", "fridge", "breakup"],
    groups: [],
    note: "the case that killed distance-as-a-judge; breakup must not be merged with anything",
  },
  {
    question: "Name something that smells like childhood",
    answers: ["cut grass", "grass", "sun cream", "plasticine"],
    groups: [[0, 1]],
  },
  {
    question: "Name a bad thing to hear a pilot say",
    answers: ["oops", "uh oh", "brace", "sorry"],
    groups: [[0, 1]],
    note: "interjections; MiniLM is weak here and a miss is expected",
  },
  {
    question: "Name something people are irrationally afraid of",
    answers: ["spiders", "spider", "heights", "clowns", "buttons"],
    groups: [[0, 1]],
  },
  {
    question: "Name a reason someone is late",
    answers: ["traffic", "the traffic", "overslept", "slept in", "bus"],
    groups: [
      [0, 1],
      [2, 3],
    ],
  },
  {
    question: "Name something you do when you are nervous",
    answers: ["bite nails", "biting my nails", "fidget", "sweat"],
    groups: [[0, 1]],
    note: "same answer, different grammar — the normaliser will not catch this one",
  },

  // --- Rounds that must produce no merges at all. ---
  {
    question: "Name a topping people argue about",
    answers: ["pineapple", "anchovy", "olives", "mushrooms"],
    groups: [],
  },
  {
    question: "Name a day of the week nobody likes",
    answers: ["Monday", "Tuesday", "Sunday", "Wednesday"],
    groups: [],
    note: "all one category and all different answers — the hardest no-merge case there is",
  },
  {
    question: "Name a room nobody sits in",
    answers: ["dining room", "front room", "utility room", "hallway"],
    groups: [],
    note: "shared word 'room' invites a merge that would be wrong",
  },
  {
    question: "Name something in a toolbox",
    answers: ["hammer", "screwdriver", "spanner", "tape measure"],
    groups: [],
  },
  {
    question: "Name a job that looks easy and is not",
    answers: ["teacher", "chef", "cleaner", "farmer"],
    groups: [],
  },
  {
    question: "Name somewhere you go to be alone",
    answers: ["bedroom", "bathroom", "car", "shed"],
    groups: [],
    note: "bedroom and bathroom are lexically close and are different answers",
  },
  {
    question: "Name something sticky",
    answers: ["honey", "glue", "tape", "syrup"],
    groups: [],
    note: "honey and syrup are close; a group would call them different answers",
  },
  {
    question: "Name the first thing you do in the morning",
    answers: ["coffee", "shower", "phone", "toilet"],
    groups: [],
  },

  // --- Whole-room shapes, to check the merge does not change who wins. ---
  {
    question: "Name something in a first aid kit",
    answers: ["plasters", "plaster", "bandage", "bandages", "scissors", "gloves"],
    groups: [
      [0, 1],
      [2, 3],
    ],
    note: "two pairs and two loners: the herd must stay a tie, so nobody scores",
  },
  {
    question: "Name something you eat standing up",
    answers: ["toast", "toast", "toast", "cereal", "crisps"],
    groups: [[0, 1, 2]],
    note: "already a herd on spelling; the model must not enlarge it",
  },
  {
    question: "Name a chore everyone puts off",
    answers: ["ironing", "the ironing", "washing up", "dishes", "hoovering"],
    groups: [
      [0, 1],
      [2, 3],
    ],
  },
  {
    question: "Name something too bright",
    answers: ["sun", "the sun", "headlights", "phone screen", "phone"],
    groups: [[0, 1]],
    note: "phone screen and phone are arguably the same; labelled apart on purpose to see what it does",
  },
  {
    question: "Name something people lie about",
    answers: ["age", "their age", "weight", "salary", "money"],
    groups: [[0, 1]],
  },
  {
    question: "Name a place with a bad queue",
    answers: ["post office", "the post office", "airport", "doctors", "GP"],
    groups: [
      [0, 1],
      [3, 4],
    ],
    note: "doctors/GP is a synonym pair the model may well miss",
  },
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? null : argv[index + 1];
  };
  const thresholds = value("thresholds")
    ?.split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return {
    thresholds: [
      ...new Set(thresholds?.length ? thresholds : [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]),
      // Always sweep the shipped value, without listing it twice when it is already in the range.
      ...(thresholds?.length ? [] : [SAME_BRAIN_SIMILARITY_THRESHOLD]),
    ]
      .filter((entry, index, all) => all.indexOf(entry) === index)
      .sort((a, b) => a - b),
    withQuestion: flag("with-question"),
    verbose: flag("verbose"),
  };
}

/** Index pairs a human said belong together. */
function intendedPairs(fixture: Fixture) {
  const pairs = new Set<string>();
  for (const group of fixture.groups)
    for (const left of group)
      for (const right of group) if (left < right) pairs.add(`${left}|${right}`);
  return pairs;
}

function answersOf(fixture: Fixture): SameBrainAnswer[] {
  return fixture.answers.map((text, index) => ({
    playerId: String(index),
    text,
    normalised: normaliseAnswer(text),
  }));
}

/** Index pairs a clustering actually put together. */
function producedPairs(clusters: Array<{ playerIds: string[] }>) {
  const pairs = new Set<string>();
  for (const cluster of clusters) {
    const ids = cluster.playerIds.map(Number).sort((a, b) => a - b);
    for (const left of ids)
      for (const right of ids) if (left < right) pairs.add(`${left}|${right}`);
  }
  return pairs;
}

async function main() {
  const { thresholds, withQuestion, verbose } = parseArgs();
  const { sameBrainSimilarity } =
    await import("@/features/things/same-brain/same-brain-embeddings.server");

  console.log(
    `\nsame brain — scorer calibration over ${FIXTURES.length} hand-labelled rounds` +
      (withQuestion ? " (question prefixed)" : "") +
      "\n",
  );

  // Exact-match baseline. Everything the model adds is measured against this.
  let baselineHits = 0;
  let baselineMissedPairs = 0;
  for (const fixture of FIXTURES) {
    const exact = producedPairs(clusterByExactMatch(answersOf(fixture)));
    const intended = intendedPairs(fixture);
    if (exact.size === intended.size && [...intended].every((pair) => exact.has(pair)))
      baselineHits += 1;
    baselineMissedPairs += [...intended].filter((pair) => !exact.has(pair)).length;
  }
  console.log(
    `exact match alone: ${baselineHits}/${FIXTURES.length} rounds correct, ` +
      `${baselineMissedPairs} agreeing pairs missed\n`,
  );

  console.log("threshold   hits   merged   WRONG   missed");
  const wrongExamples = new Map<number, string[]>();
  const scores = new Map<number, { hits: number; merged: number; wrong: number; missed: number }>();

  for (const threshold of thresholds) {
    let hits = 0;
    let merged = 0;
    let wrong = 0;
    let missed = 0;
    const examples: string[] = [];

    for (const fixture of FIXTURES) {
      const answers = answersOf(fixture);
      const exact = clusterByExactMatch(answers);
      const words = answers.map(({ normalised }) =>
        withQuestion ? `${fixture.question}: ${normalised}` : normalised,
      );
      const similarity = await sameBrainSimilarity(words);

      const clusters = similarity
        ? upgradeClusters(
            exact,
            // The prefixed form is what was embedded, so that is what must be looked up.
            withQuestion
              ? (a, b) => similarity(`${fixture.question}: ${a}`, `${fixture.question}: ${b}`)
              : similarity,
            threshold,
          )
        : exact;

      const produced = producedPairs(clusters);
      const intended = intendedPairs(fixture);
      const exactPairs = producedPairs(exact);

      const correct =
        produced.size === intended.size && [...intended].every((p) => produced.has(p));
      if (correct) hits += 1;
      for (const pair of produced) {
        if (intended.has(pair)) {
          if (!exactPairs.has(pair)) merged += 1;
          continue;
        }
        wrong += 1;
        const [left, right] = pair.split("|").map(Number);
        examples.push(`${fixture.answers[left]} + ${fixture.answers[right]} (${fixture.question})`);
      }
      missed += [...intended].filter((pair) => !produced.has(pair)).length;
    }

    wrongExamples.set(threshold, examples);
    scores.set(threshold, { hits, merged, wrong, missed });
    const mark = threshold === SAME_BRAIN_SIMILARITY_THRESHOLD ? " ←shipped" : "";
    console.log(
      `${threshold.toFixed(2)}        ${String(hits).padStart(2)}     ${String(merged).padStart(3)}      ${String(wrong).padStart(3)}     ${String(missed).padStart(3)}${mark}`,
    );
  }

  console.log("\nwrong merges, by threshold:");
  for (const [threshold, examples] of wrongExamples) {
    if (examples.length === 0) {
      console.log(`  ${threshold.toFixed(2)}  none`);
      continue;
    }
    console.log(`  ${threshold.toFixed(2)}  ${examples.length}`);
    for (const example of verbose ? examples : examples.slice(0, 4))
      console.log(`        ${example}`);
  }

  /**
   * The verdict. Zero wrong merges is the ideal and rarely available — a couple of English words
   * genuinely do sit on top of each other. What matters is the ratio: at eight correct merges per
   * mistake the model is clearly earning its place, at two it is not, and somewhere between those the
   * honest answer is to ship `exact` as the default and leave `embedding` as a house rule.
   */
  const verdicts = [...scores.entries()].map(([threshold, score]) => ({
    threshold,
    ...score,
    ratio: score.wrong === 0 ? Infinity : score.merged / score.wrong,
  }));
  const best = verdicts.filter(({ ratio }) => ratio >= 5).sort((a, b) => b.merged - a.merged)[0];

  if (!best) {
    console.log(
      "\nNo threshold reaches five correct merges per mistake. Ship `exact` as the default and\n" +
        "leave `embedding` as a house rule for groups that want it.\n",
    );
    return;
  }
  console.log(
    `\nBest safe threshold: ${best.threshold.toFixed(2)} — ${best.merged} correct merges against ` +
      `${best.wrong} wrong (${best.ratio === Infinity ? "no" : `${best.ratio.toFixed(1)}:1`} ratio),\n` +
      `lifting ${baselineHits}/${FIXTURES.length} rounds to ${best.hits}/${FIXTURES.length}.\n` +
      `Shipped: ${SAME_BRAIN_SIMILARITY_THRESHOLD}` +
      (best.threshold === SAME_BRAIN_SIMILARITY_THRESHOLD
        ? " — matches.\n"
        : ` — consider changing it.\n`),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
