#!/usr/bin/env tsx
/**
 * Builds the private Hot and Cold lexicon and rank tables.
 *
 * Inputs:
 * - Open English WordNet 2025 for words, inflections, definitions, and lexical relations.
 * - SUBTLEX-US word frequencies for a spoken-English familiarity filter.
 * - The bundled all-MiniLM-L6-v2 model for semantic similarity.
 *
 * The game server reads only the generated assets. It never runs an embedding model in play.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { env, matmul, pipeline, type Tensor } from "@huggingface/transformers";
import {
  HOT_AND_COLD_TARGETS,
  HOT_AND_COLD_TARGET_SENSES,
} from "../features/things/hot-and-cold/hot-and-cold-words.server";
import {
  HOT_AND_COLD_ASSET_SCHEMA_VERSION,
  HOT_AND_COLD_LATEST_JUDGING_VERSION,
} from "../features/things/hot-and-cold/hot-and-cold-rules";
import {
  HOT_AND_COLD_HUMAN_TRAILS,
  hotAndColdApprovalHash,
} from "../features/things/hot-and-cold/hot-and-cold-quality.server";
import { normaliseGameWord } from "../features/things/shared/word-normalization";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, ".artifacts", "hot-and-cold");
const SOURCE_FILE = path.join(SOURCE_DIR, "english-wordnet-2025.xml.gz");
const ASSET_ROOT = path.join(ROOT, "runtime-assets", "hot-and-cold");
const OUTPUT_DIR = path.join(ASSET_ROOT, HOT_AND_COLD_LATEST_JUDGING_VERSION);
const PREVIOUS_ASSET_DIR = path.join(ASSET_ROOT, "1.0.0");
const SCORE_CACHE_FILE = path.join(SOURCE_DIR, "scores-2.0.0.data");
const SCORE_CACHE_META = path.join(SOURCE_DIR, "scores-2.0.0.json");
const WORDNET_URL = "https://en-word.net/static/english-wordnet-2025.xml.gz";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 256;
const MIN_FREQUENCY = 2;
const RANK_PACK_COUNT = 16;
const ASSOCIATION_WEIGHT = 0.72;
const INTENDED_SENSE_WEIGHT = 0.25;
const WORDNET_SYNONYM_BOOST = 0.05;
const WORDNET_RELATION_BOOST = 0.025;
const MAX_ALTERNATIVE_SENSE_PENALTY = 0.1;
const MIN_AUTOMATIC_HINT_FREQUENCY = 50;
const AUTOMATIC_HINT_MAX_RANKS = [250, 100, 30] as const;
const HINT_CURATION_REQUIRED = new Set<string>();

const CURATED_HINTS: Partial<Record<(typeof HOT_AND_COLD_TARGETS)[number], string[]>> = {
  avalanche: ["ice", "storm", "snow"],
  crab: ["claw", "shrimp", "lobster"],
  dolphin: ["ocean", "mammal", "whale"],
  mushroom: ["pizza", "food", "fungus"],
  orchard: ["fruit", "tree", "farm"],
  panda: ["zoo", "animal", "bear"],
  penguin: ["ice", "fish", "bird"],
  pillow: ["soft", "duvet", "sleep"],
  scarf: ["helmet", "blanket", "shawl"],
  shark: ["ocean", "predator", "fin"],
  snowman: ["cold", "winter", "frost"],
  whale: ["ocean", "giant", "mammal"],
  windmill: ["electricity", "breeze", "turbine"],
};

const CURATED_TARGET_CONTEXTS: Partial<Record<(typeof HOT_AND_COLD_TARGETS)[number], string>> = {
  mushroom: "an edible fungus with a stalk and cap, used as food and on pizza",
  orchard: "land planted with fruit trees such as apple and pear trees",
  panda: "a black-and-white bear from China that lives in bamboo forest and eats bamboo",
  penguin: "a flightless black-and-white bird that swims and lives in cold Antarctic regions",
  pillow: "a soft cushion that supports your head in bed while sleeping",
  scarf:
    "a warm clothing accessory worn around the neck with a coat, hat, or gloves in cold weather",
  shark: "a predatory ocean fish with fins, rows of sharp teeth, and rough skin",
  snowman: "a person-shaped figure built from snow, often with a carrot nose, hat, and scarf",
  sun: "the star at the centre of the solar system that gives Earth daylight, light, and warmth",
  whale: "a huge marine mammal that lives in the ocean and breathes through a blowhole",
  windmill: "a mill or turbine whose sails turn in the wind to provide power or electricity",
};

const require = createRequire(import.meta.url);
const frequencies = require("subtlex-word-frequencies") as Array<{
  word: string;
  count: number;
}>;

interface LexicalWord {
  definitions: string[];
  forms: Set<string>;
  frequency: number;
  partsOfSpeech: Set<string>;
  senses: Array<{ definition: string; id: string; partOfSpeech: string }>;
  synsets: Set<string>;
}

interface Manifest {
  aliases: Record<string, string>;
  formatVersion: number;
  hints: Record<string, string[]>;
  judgingVersion: string;
  rankingPolicy: {
    alternativeSensePenalty: number;
    associationWeight: number;
    intendedSenseWeight: number;
    wordnetBoostCap: number;
    targetSenses: string;
  };
  rankPacks: Record<string, { file: string; offset: number }>;
  source: {
    embeddingModel: string;
    frequencyList: string;
    wordnet: string;
  };
  targetSenses: Record<string, { definition: string; synset: string }>;
  targetContexts: Record<string, string>;
  review: Record<string, TargetReview>;
  trails: Record<string, string[]>;
  words: string[];
}

interface RankedWordReview {
  frequency: number;
  rank: number;
  reasons: string[];
  word: string;
}

interface RankChangeReview {
  change: number;
  previousRank: number;
  rank: number;
  word: string;
}

interface TargetReview {
  approvalHash: string;
  changes: RankChangeReview[];
  comparisons: Array<{
    closer: string;
    closerRank: number;
    farther: string;
    fartherRank: number;
    passes: boolean;
  }>;
  expectedClose: Array<{ rank: number; word: string }>;
  suspicious: RankedWordReview[];
  top: RankedWordReview[];
}

const EXCLUDED_WORDS = new Set([
  "ain",
  "aren",
  "couldn",
  "didn",
  "doesn",
  "don",
  "hadn",
  "hasn",
  "haven",
  "isn",
  "mightn",
  "mustn",
  "shan",
  "shouldn",
  "wasn",
  "weren",
  "won",
  "wouldn",
]);

// Named entities need a deliberate editorial bar. Places and culturally useful
// figures can create good semantic trails; ordinary given names do not.
const INCLUDED_NAMED_ENTITIES = new Map([
  ["london", ["the capital city of England and the United Kingdom, on the River Thames"]],
  ["mozart", ["an Austrian composer of the Classical period"]],
]);

function decodeXml(value: string) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function cleanWord(value: string) {
  const word = normaliseGameWord(decodeXml(value));
  return /^[a-z]+(?:-[a-z]+)?$/.test(word) && word.length >= 2 ? word : null;
}

function cleanLexicalWord(value: string) {
  const decoded = decodeXml(value);
  const word = cleanWord(decoded);
  return decoded === decoded.toLocaleLowerCase("en-GB") ||
    (word && INCLUDED_NAMED_ENTITIES.has(word))
    ? word
    : null;
}

function cleanDefinition(value: string) {
  return decodeXml(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function ensureWordNet() {
  if (fs.existsSync(SOURCE_FILE)) return;
  fs.mkdirSync(SOURCE_DIR, { recursive: true });
  console.log(`downloading ${WORDNET_URL}`);
  const response = await fetch(WORDNET_URL);
  if (!response.ok) throw new Error(`WordNet download failed: ${response.status}`);
  fs.writeFileSync(SOURCE_FILE, new Uint8Array(await response.arrayBuffer()));
}

function parseWordNet(xml: string) {
  const lexical = new Map<string, LexicalWord>();
  const synsetDefinitions = new Map<string, string>();
  const synsetNeighbours = new Map<string, Set<string>>();

  for (const match of xml.matchAll(/<LexicalEntry\b[^>]*>([\s\S]*?)<\/LexicalEntry>/g)) {
    const body = match[1];
    const lemmaMatch = body.match(/<Lemma\b[^>]*writtenForm="([^"]+)"/);
    const lemma = lemmaMatch ? cleanLexicalWord(lemmaMatch[1]) : null;
    if (!lemma) continue;
    const partOfSpeech = body.match(/<Lemma\b[^>]*partOfSpeech="([^"]+)"/)?.[1];
    const current = lexical.get(lemma) ?? {
      definitions: [],
      forms: new Set<string>(),
      frequency: 0,
      partsOfSpeech: new Set<string>(),
      senses: [],
      synsets: new Set<string>(),
    };
    if (partOfSpeech) current.partsOfSpeech.add(partOfSpeech);
    for (const sense of body.matchAll(/<Sense\b[^>]*synset="([^"]+)"/g)) {
      current.synsets.add(sense[1]);
      if (!current.senses.some(({ id }) => id === sense[1]))
        current.senses.push({ definition: "", id: sense[1], partOfSpeech: partOfSpeech ?? "" });
    }
    for (const formMatch of body.matchAll(/<Form\b[^>]*writtenForm="([^"]+)"/g)) {
      const form = cleanLexicalWord(formMatch[1]);
      if (form && form !== lemma) current.forms.add(form);
    }
    lexical.set(lemma, current);
  }

  for (const match of xml.matchAll(/<Synset\b([^>]*)>([\s\S]*?)<\/Synset>/g)) {
    const id = match[1].match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const definition = match[2].match(/<Definition>([\s\S]*?)<\/Definition>/)?.[1];
    if (definition) synsetDefinitions.set(id, cleanDefinition(definition));
    const neighbours = new Set<string>();
    for (const relation of match[2].matchAll(
      /<SynsetRelation\b[^>]*relType="(?:also|antonym|attribute|entails|hypernym|hyponym|mero_member|mero_part|mero_substance|similar)"[^>]*target="([^"]+)"/g,
    ))
      neighbours.add(relation[1]);
    if (neighbours.size) synsetNeighbours.set(id, neighbours);
  }

  for (const word of lexical.values()) {
    word.definitions = [...word.synsets]
      .map((id) => synsetDefinitions.get(id))
      .filter((definition): definition is string => Boolean(definition))
      .slice(0, 3);
    word.senses = word.senses
      .map((sense) => ({ ...sense, definition: synsetDefinitions.get(sense.id) ?? "" }))
      .filter(({ definition }) => Boolean(definition));
  }
  for (const [synset, neighbours] of synsetNeighbours)
    for (const neighbour of neighbours) {
      const reverse = synsetNeighbours.get(neighbour) ?? new Set<string>();
      reverse.add(synset);
      synsetNeighbours.set(neighbour, reverse);
    }
  for (const [word, definitions] of INCLUDED_NAMED_ENTITIES)
    if (!lexical.has(word))
      lexical.set(word, {
        definitions,
        forms: new Set<string>(),
        frequency: 0,
        partsOfSpeech: new Set(["n"]),
        senses: [],
        synsets: new Set<string>(),
      });
  return { lexical, synsetNeighbours };
}

function buildLexicon(lexical: Map<string, LexicalWord>) {
  const observedWords = new Set<string>();
  for (const item of frequencies) {
    const word = cleanWord(item.word);
    if (word && item.count >= MIN_FREQUENCY) observedWords.add(word);
    if (word && lexical.has(word)) lexical.get(word)!.frequency = Math.max(item.count, 0);
  }
  const words = [...lexical.entries()]
    .filter(
      ([word, value]) =>
        value.frequency >= MIN_FREQUENCY && !EXCLUDED_WORDS.has(word) && !/^\w{1,2}-\w/.test(word),
    )
    .map(([word]) => word);
  for (const target of HOT_AND_COLD_TARGETS) if (!words.includes(target)) words.push(target);
  words.sort((left, right) => left.localeCompare(right));
  if (words.length >= 65_535) throw new Error("Hot and Cold lexicon no longer fits UInt16 ranks");
  const targetWords = new Set<string>(HOT_AND_COLD_TARGETS);
  const scoredWords = new Set(words);
  const aliasCandidates = new Map<string, Set<string>>();
  const addAlias = (form: string, lemma: string) => {
    if (form === lemma || targetWords.has(form) || scoredWords.has(form)) return;
    const candidates = aliasCandidates.get(form) ?? new Set<string>();
    candidates.add(lemma);
    aliasCandidates.set(form, candidates);
  };
  const regularForms = (lemma: string, partsOfSpeech: Set<string>) => {
    const forms = new Set<string>();
    if (partsOfSpeech.has("n")) {
      if (/[^aeiou]y$/.test(lemma)) forms.add(`${lemma.slice(0, -1)}ies`);
      else if (/(?:s|x|z|ch|sh)$/.test(lemma)) forms.add(`${lemma}es`);
      else forms.add(`${lemma}s`);
    }
    if (partsOfSpeech.has("v")) {
      if (/[^aeiou]y$/.test(lemma)) {
        forms.add(`${lemma.slice(0, -1)}ies`);
        forms.add(`${lemma.slice(0, -1)}ied`);
      } else {
        forms.add(/(?:s|x|z|ch|sh)$/.test(lemma) ? `${lemma}es` : `${lemma}s`);
        forms.add(lemma.endsWith("e") ? `${lemma}d` : `${lemma}ed`);
      }
      forms.add(
        lemma.endsWith("e") && !/(?:ee|ye|oe)$/.test(lemma)
          ? `${lemma.slice(0, -1)}ing`
          : `${lemma}ing`,
      );
    }
    if (partsOfSpeech.has("a") || partsOfSpeech.has("s")) {
      if (/[^aeiou]y$/.test(lemma)) {
        forms.add(`${lemma.slice(0, -1)}ier`);
        forms.add(`${lemma.slice(0, -1)}iest`);
      } else if (lemma.endsWith("e")) {
        forms.add(`${lemma}r`);
        forms.add(`${lemma}st`);
      } else {
        forms.add(`${lemma}er`);
        forms.add(`${lemma}est`);
      }
    }
    return forms;
  };
  for (const lemma of words) {
    const entry = lexical.get(lemma);
    if (!entry) continue;
    for (const form of entry.forms) addAlias(form, lemma);
    for (const form of regularForms(lemma, entry.partsOfSpeech))
      if (observedWords.has(form)) addAlias(form, lemma);
  }
  const aliases: Record<string, string> = {};
  for (const [form, candidates] of aliasCandidates)
    if (candidates.size === 1) aliases[form] = [...candidates][0];
  return { aliases, words };
}

function ordinarySense(word: LexicalWord | undefined) {
  return word?.senses[0] ?? null;
}

function selectedTargetSense(target: string, lexical: Map<string, LexicalWord>) {
  const entry = lexical.get(target);
  const requested = HOT_AND_COLD_TARGET_SENSES[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  const sense = requested
    ? entry?.senses.find(({ id }) => id === requested)
    : entry?.senses.find(({ partOfSpeech }) => partOfSpeech === "n");
  if (!sense)
    throw new Error(
      `No intended WordNet sense is available for Hot and Cold target ${target}${requested ? ` (${requested})` : ""}`,
    );
  return sense;
}

function targetContext(target: string, lexical: Map<string, LexicalWord>) {
  const sense = selectedTargetSense(target, lexical);
  const reviewed = CURATED_TARGET_CONTEXTS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  return `${target}: ${reviewed ?? sense.definition}`;
}

function targetAssociationWords(target: string) {
  const trail = HOT_AND_COLD_HUMAN_TRAILS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  const comparisonWords = new Set(trail?.comparisons.map(({ farther }) => farther));
  const anchors = trail?.closeWords.filter((word) => !comparisonWords.has(word)).slice(0, 5) ?? [];
  return [target, ...anchors];
}

function relatedWords(
  target: string,
  lexical: Map<string, LexicalWord>,
  synsetNeighbours: Map<string, Set<string>>,
) {
  const targetSense = selectedTargetSense(target, lexical);
  return {
    targetSense,
    directSynsets: new Set(synsetNeighbours.get(targetSense.id) ?? []),
  };
}

function candidateSenseTexts(word: string, lexical: Map<string, LexicalWord>) {
  const senses = lexical.get(word)?.senses.slice(0, 6) ?? [];
  if (senses.length) return senses.map(({ definition }) => `${word}: ${definition}`);
  const definition = lexical.get(word)?.definitions[0];
  return [definition ? `${word}: ${definition}` : word];
}

function tensorRow(
  data: { length: number; [index: number]: number | bigint },
  row: number,
  columns: number,
) {
  return Float32Array.from({ length: columns }, (_, column) =>
    Number(data[row * columns + column]),
  );
}

async function generateRanks(
  words: string[],
  lexical: Map<string, LexicalWord>,
  synsetNeighbours: Map<string, Set<string>>,
) {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useFSCache = false;
  env.localModelPath = path.join(ROOT, "models");
  const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const targetWords = [...HOT_AND_COLD_TARGETS];
  const targetRelations = targetWords.map((target) =>
    relatedWords(target, lexical, synsetNeighbours),
  );
  const associationGroups = targetWords.map(targetAssociationWords);
  const associationOffsets: number[] = [];
  let associationOffset = 0;
  for (const group of associationGroups) {
    associationOffsets.push(associationOffset);
    associationOffset += group.length;
  }
  const associationTargets = (await extractor(associationGroups.flat(), {
    pooling: "mean",
    normalize: true,
  })) as Tensor;
  const contextTargets = (await extractor(
    targetWords.map((target) => targetContext(target, lexical)),
    { pooling: "mean", normalize: true },
  )) as Tensor;
  const associationTargetT = associationTargets.transpose(1, 0);
  const contextTargetT = contextTargets.transpose(1, 0);
  const scores = targetWords.map(() => new Float32Array(words.length));

  for (let start = 0; start < words.length; start += BATCH_SIZE) {
    const batch = words.slice(start, start + BATCH_SIZE);
    const raw = (await extractor(batch, { pooling: "mean", normalize: true })) as Tensor;
    const contexts = batch.map((word) => candidateSenseTexts(word, lexical));
    const flattenedContexts = contexts.flat();
    const context = (await extractor(flattenedContexts, {
      pooling: "mean",
      normalize: true,
    })) as Tensor;
    const rawScores = await matmul(raw, associationTargetT);
    const contextScores = await matmul(context, contextTargetT);
    let contextRow = 0;
    for (let row = 0; row < batch.length; row += 1) {
      const rawRow = tensorRow(rawScores.data, row, associationOffset);
      const contextualRows = contexts[row].map(() => {
        const values = tensorRow(contextScores.data, contextRow, targetWords.length);
        contextRow += 1;
        return values;
      });
      const word = batch[row];
      const ordinary = ordinarySense(lexical.get(word));
      for (let targetIndex = 0; targetIndex < targetWords.length; targetIndex += 1) {
        const target = targetWords[targetIndex];
        const related = targetRelations[targetIndex];
        const associationStart = associationOffsets[targetIndex];
        const associationValues = associationGroups[targetIndex].map(
          (_, anchorIndex) => rawRow[associationStart + anchorIndex],
        );
        const associationMean =
          associationValues.reduce((sum, value) => sum + value, 0) / associationValues.length;
        const associationScore = associationMean * 0.6 + Math.max(...associationValues) * 0.4;
        const synonymous = ordinary?.id === related.targetSense.id;
        const directlyRelated = ordinary ? related.directSynsets.has(ordinary.id) : false;
        const ordinarySenseScore = contextualRows[0][targetIndex];
        const alternativeSenseScore = Math.max(
          ordinarySenseScore,
          ...contextualRows.slice(1).map((values) => values[targetIndex]),
        );
        const alternativeSensePenalty = Math.min(
          MAX_ALTERNATIVE_SENSE_PENALTY,
          Math.max(0, alternativeSenseScore - Math.max(associationScore, ordinarySenseScore)) * 0.5,
        );
        const substringArtifact =
          !synonymous &&
          !directlyRelated &&
          Math.min(word.length, target.length) >= 3 &&
          (word.includes(target) || target.includes(word));
        scores[targetIndex][start + row] =
          associationScore * ASSOCIATION_WEIGHT +
          ordinarySenseScore * INTENDED_SENSE_WEIGHT +
          (synonymous ? WORDNET_SYNONYM_BOOST : directlyRelated ? WORDNET_RELATION_BOOST : 0) -
          alternativeSensePenalty -
          (substringArtifact ? 0.1 : 0);
      }
    }
    process.stdout.write(
      `\rranking ${Math.min(start + batch.length, words.length)}/${words.length}`,
    );
  }
  process.stdout.write("\n");
  return scores;
}

async function generateOrReadScores(
  words: string[],
  lexical: Map<string, LexicalWord>,
  synsetNeighbours: Map<string, Set<string>>,
) {
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        model: MODEL,
        words,
        targets: HOT_AND_COLD_TARGETS.map((target) => targetContext(target, lexical)),
        associations: HOT_AND_COLD_TARGETS.map(targetAssociationWords),
        associationWeight: ASSOCIATION_WEIGHT,
        intendedSenseWeight: INTENDED_SENSE_WEIGHT,
        synonymBoost: WORDNET_SYNONYM_BOOST,
        relationBoost: WORDNET_RELATION_BOOST,
        alternativeSensePenalty: MAX_ALTERNATIVE_SENSE_PENALTY,
        scoring: generateRanks.toString(),
      }),
    )
    .digest("hex");
  const expectedBytes = HOT_AND_COLD_TARGETS.length * words.length * Float32Array.BYTES_PER_ELEMENT;
  if (fs.existsSync(SCORE_CACHE_FILE) && fs.existsSync(SCORE_CACHE_META)) {
    const metadata = JSON.parse(fs.readFileSync(SCORE_CACHE_META, "utf8")) as {
      bytes?: number;
      signature?: string;
    };
    const bytes = fs.readFileSync(SCORE_CACHE_FILE);
    if (
      metadata.signature === signature &&
      metadata.bytes === expectedBytes &&
      bytes.length === expectedBytes
    ) {
      console.log("reusing calibrated score cache");
      const targetBytes = words.length * Float32Array.BYTES_PER_ELEMENT;
      return HOT_AND_COLD_TARGETS.map((_, targetIndex) =>
        Float32Array.from(
          new Float32Array(
            bytes.buffer,
            bytes.byteOffset + targetIndex * targetBytes,
            words.length,
          ),
        ),
      );
    }
  }
  const scores = await generateRanks(words, lexical, synsetNeighbours);
  fs.writeFileSync(
    SCORE_CACHE_FILE,
    Buffer.concat(
      scores.map((score) => Buffer.from(score.buffer, score.byteOffset, score.byteLength)),
    ),
  );
  fs.writeFileSync(SCORE_CACHE_META, JSON.stringify({ bytes: expectedBytes, signature }));
  return scores;
}

function rankAndHints(
  target: string,
  words: string[],
  score: Float32Array,
  lexical: Map<string, LexicalWord>,
) {
  const order = words
    .map((_, index) => index)
    .sort((left, right) => {
      if (words[left] === target) return -1;
      if (words[right] === target) return 1;
      return score[right] - score[left] || words[left].localeCompare(words[right]);
    });
  const ranks = new Uint16Array(words.length);
  order.forEach((wordIndex, index) => {
    ranks[wordIndex] = index;
  });
  const humanTrail = HOT_AND_COLD_HUMAN_TRAILS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  const curated =
    humanTrail?.approvedHints ?? CURATED_HINTS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  if (curated) {
    if (curated.some((word) => !words.includes(word) || word === target))
      throw new Error(`Curated hints are invalid for ${target}: ${curated.join(", ")}`);
    const hints = [...curated].sort(
      (left, right) => ranks[words.indexOf(right)] - ranks[words.indexOf(left)],
    );
    return { hints, ranks, trail: order.slice(0, 30).map((index) => words[index]) };
  }
  const safeHint = (word: string) =>
    word !== target &&
    !word.includes(target) &&
    !target.includes(word) &&
    word.length >= 4 &&
    (lexical.get(word)?.frequency ?? 0) >= MIN_AUTOMATIC_HINT_FREQUENCY &&
    Boolean(ordinarySense(lexical.get(word))?.id) &&
    (lexical.get(word)?.senses.length ?? 0) <= 2;
  const candidates = order
    .slice(1, 2_000)
    .map((index) => words[index])
    .filter(safeHint);
  if (candidates.length < 3) {
    HINT_CURATION_REQUIRED.add(target);
    const fallback = order
      .slice(1, 2_000)
      .map((index) => words[index])
      .filter(
        (word) =>
          word.length >= 4 &&
          !word.includes(target) &&
          !target.includes(word) &&
          (lexical.get(word)?.frequency ?? 0) >= MIN_AUTOMATIC_HINT_FREQUENCY,
      )
      .slice(0, 3)
      .toReversed();
    if (fallback.length < 3) throw new Error(`No provisional hints are available for ${target}`);
    return { hints: fallback, ranks, trail: order.slice(0, 30).map((index) => words[index]) };
  }
  const desiredRanks = [100, 40, 10] as const;
  const penalty = (candidateIndex: number, desiredRank: number) => {
    const rank = ranks[words.indexOf(candidates[candidateIndex])];
    return Math.abs(Math.log((rank + 1) / (desiredRank + 1)));
  };
  const bestHotBefore = new Int32Array(candidates.length).fill(-1);
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = bestHotBefore[index - 1];
    bestHotBefore[index] =
      previous < 0 || penalty(index - 1, desiredRanks[2]) < penalty(previous, desiredRanks[2])
        ? index - 1
        : previous;
  }
  const bestColdAfter = new Int32Array(candidates.length).fill(-1);
  for (let index = candidates.length - 2; index >= 0; index -= 1) {
    const previous = bestColdAfter[index + 1];
    bestColdAfter[index] =
      previous < 0 || penalty(index + 1, desiredRanks[0]) < penalty(previous, desiredRanks[0])
        ? index + 1
        : previous;
  }
  let best: { hints: string[]; penalty: number } | null = null;
  for (let middle = 1; middle < candidates.length - 1; middle += 1) {
    const hot = bestHotBefore[middle];
    const cold = bestColdAfter[middle];
    const total =
      penalty(cold, desiredRanks[0]) +
      penalty(middle, desiredRanks[1]) +
      penalty(hot, desiredRanks[2]);
    if (!best || total < best.penalty)
      best = { hints: [candidates[cold], candidates[middle], candidates[hot]], penalty: total };
  }
  const hints = best?.hints;
  if (!hints) throw new Error(`Hot and Cold needs progressive trustworthy hints for ${target}`);
  if (hints.some((word, index) => ranks[words.indexOf(word)] > AUTOMATIC_HINT_MAX_RANKS[index]))
    HINT_CURATION_REQUIRED.add(target);
  return { hints, ranks, trail: order.slice(0, 30).map((index) => words[index]) };
}

interface PreviousManifest {
  rankPacks: Record<string, { file: string; offset: number }>;
  words: string[];
}

function readPreviousManifest(): PreviousManifest | null {
  const file = path.join(PREVIOUS_ASSET_DIR, "lexicon.data");
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as PreviousManifest)
    : null;
}

function previousRanksFor(target: string, manifest: PreviousManifest | null) {
  const location = manifest?.rankPacks[target];
  if (!manifest || !location) return null;
  const bytes = fs.readFileSync(path.join(PREVIOUS_ASSET_DIR, location.file));
  return new Uint16Array(bytes.buffer, bytes.byteOffset + location.offset, manifest.words.length);
}

function validateGeneratedTarget(
  target: string,
  words: string[],
  ranks: Uint16Array,
  hints: string[],
  lexical: Map<string, LexicalWord>,
) {
  const targetIndex = words.indexOf(target);
  if (targetIndex < 0 || ranks[targetIndex] !== 0) throw new Error(`${target} is not rank zero`);
  const seen = new Uint8Array(words.length);
  for (const rank of ranks) {
    if (rank >= words.length || seen[rank])
      throw new Error(`${target} has an incomplete rank table`);
    seen[rank] = 1;
  }
  const hintRanks = hints.map((word) => ranks[words.indexOf(word)]);
  if (
    hints.length !== 3 ||
    hintRanks.some((rank, index) => index > 0 && rank >= hintRanks[index - 1])
  )
    throw new Error(`${target} does not have three progressively closer hints`);
  for (const hint of hints) {
    const record = HOT_AND_COLD_HUMAN_TRAILS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
    const explicitlyApproved =
      (record?.approvedHints.includes(hint) ?? false) ||
      (CURATED_HINTS[target as (typeof HOT_AND_COLD_TARGETS)[number]]?.includes(hint) ?? false);
    if (
      hint.includes(target) ||
      target.includes(hint) ||
      (!explicitlyApproved && (lexical.get(hint)?.frequency ?? 0) < MIN_AUTOMATIC_HINT_FREQUENCY) ||
      (!explicitlyApproved && (lexical.get(hint)?.senses.length ?? 0) > 4)
    )
      throw new Error(`${target} has an unsafe official hint: ${hint}`);
    if (record?.forbiddenHints?.includes(hint))
      throw new Error(`${target} uses a forbidden official hint: ${hint}`);
  }
}

function targetReview(
  target: string,
  words: string[],
  ranks: Uint16Array,
  hints: string[],
  trail: string[],
  lexical: Map<string, LexicalWord>,
  previousManifest: PreviousManifest | null,
): TargetReview {
  const index = new Map(words.map((word, wordIndex) => [word, wordIndex]));
  const rankOf = (word: string) => {
    const wordIndex = index.get(word);
    if (wordIndex === undefined) throw new Error(`${target} quality trail references ${word}`);
    return ranks[wordIndex];
  };
  const describe = (word: string): RankedWordReview => {
    const entry = lexical.get(word);
    const reasons: string[] = [];
    if ((entry?.frequency ?? 0) < MIN_AUTOMATIC_HINT_FREQUENCY) reasons.push("rare");
    if ((entry?.senses.length ?? 0) > 3) reasons.push("polysemous");
    return { word, rank: rankOf(word), frequency: entry?.frequency ?? 0, reasons };
  };
  const record = HOT_AND_COLD_HUMAN_TRAILS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  const comparisons = (record?.comparisons ?? []).map(({ closer, farther }) => ({
    closer,
    closerRank: rankOf(closer),
    farther,
    fartherRank: rankOf(farther),
    passes: rankOf(closer) < rankOf(farther),
  }));
  const failed = comparisons.filter(({ passes }) => !passes);
  if (failed.length)
    throw new Error(
      `${target} failed comparisons: ${failed
        .map(
          ({ closer, closerRank, farther, fartherRank }) =>
            `${closer} #${closerRank} < ${farther} #${fartherRank}`,
        )
        .join(", ")}`,
    );
  const expectedClose = (record?.closeWords ?? []).map((word) => ({ word, rank: rankOf(word) }));
  if (expectedClose.some(({ rank }) => rank > 1_000))
    throw new Error(`${target} has an expected close word outside the top 1,000`);

  const previousRanks = previousRanksFor(target, previousManifest);
  const previousIndex = previousManifest
    ? new Map(previousManifest.words.map((word, wordIndex) => [word, wordIndex]))
    : null;
  const changes = previousRanks
    ? words
        .flatMap((word, wordIndex) => {
          const oldIndex = previousIndex?.get(word);
          if (oldIndex === undefined) return [];
          const previousRank = previousRanks[oldIndex];
          const rank = ranks[wordIndex];
          return [{ word, rank, previousRank, change: rank - previousRank }];
        })
        .sort(
          (left, right) =>
            Math.abs(right.change) - Math.abs(left.change) || left.word.localeCompare(right.word),
        )
        .slice(0, 20)
    : [];
  const top = trail.map(describe);
  return {
    approvalHash: hotAndColdApprovalHash(target, trail, hints),
    changes,
    comparisons,
    expectedClose,
    suspicious: top.filter(({ reasons }) => reasons.length > 0),
    top,
  };
}

async function main() {
  await ensureWordNet();
  console.log("reading Open English WordNet");
  const xml = gunzipSync(fs.readFileSync(SOURCE_FILE)).toString("utf8");
  const { lexical, synsetNeighbours } = parseWordNet(xml);
  const { aliases, words } = buildLexicon(lexical);
  console.log(
    `${words.length.toLocaleString()} accepted words · ${Object.keys(aliases).length.toLocaleString()} inflections`,
  );
  const scores = await generateOrReadScores(words, lexical, synsetNeighbours);
  const hints: Record<string, string[]> = {};
  const review: Record<string, TargetReview> = {};
  const trails: Record<string, string[]> = {};
  const rankPacks: Record<string, { file: string; offset: number }> = {};
  const packChunks = Array.from({ length: RANK_PACK_COUNT }, () => [] as Buffer[]);
  const packLengths = new Uint32Array(RANK_PACK_COUNT);
  const previousManifest = readPreviousManifest();
  HOT_AND_COLD_TARGETS.forEach((target, index) => {
    const result = rankAndHints(target, words, scores[index], lexical);
    validateGeneratedTarget(target, words, result.ranks, result.hints, lexical);
    hints[target] = result.hints;
    trails[target] = result.trail;
    review[target] = targetReview(
      target,
      words,
      result.ranks,
      result.hints,
      result.trail,
      lexical,
      previousManifest,
    );
    const packIndex = index % RANK_PACK_COUNT;
    const file = `ranks-${packIndex.toString().padStart(2, "0")}.data`;
    const bytes = Buffer.from(result.ranks.buffer);
    rankPacks[target] = { file, offset: packLengths[packIndex] };
    packChunks[packIndex].push(bytes);
    packLengths[packIndex] += bytes.byteLength;
  });
  if (HINT_CURATION_REQUIRED.size > 0)
    throw new Error(`Curated hints are required for: ${[...HINT_CURATION_REQUIRED].join(", ")}`);
  const manifest: Manifest = {
    aliases,
    formatVersion: HOT_AND_COLD_ASSET_SCHEMA_VERSION,
    hints,
    judgingVersion: HOT_AND_COLD_LATEST_JUDGING_VERSION,
    rankingPolicy: {
      alternativeSensePenalty: MAX_ALTERNATIVE_SENSE_PENALTY,
      associationWeight: ASSOCIATION_WEIGHT,
      intendedSenseWeight: INTENDED_SENSE_WEIGHT,
      wordnetBoostCap: WORDNET_SYNONYM_BOOST,
      targetSenses: "one reviewed ordinary noun sense and context per target",
    },
    rankPacks,
    review,
    source: {
      embeddingModel: MODEL,
      frequencyList: "SUBTLEX-US via subtlex-word-frequencies 2.0.0",
      wordnet: "Open English WordNet 2025",
    },
    targetSenses: Object.fromEntries(
      HOT_AND_COLD_TARGETS.map((target) => {
        const sense = selectedTargetSense(target, lexical);
        return [target, { definition: sense.definition, synset: sense.id }];
      }),
    ),
    targetContexts: Object.fromEntries(
      HOT_AND_COLD_TARGETS.map((target) => [target, targetContext(target, lexical)]),
    ),
    trails,
    words,
  };
  const temporaryOutput = `${OUTPUT_DIR}.tmp`;
  fs.rmSync(temporaryOutput, { recursive: true, force: true });
  fs.mkdirSync(temporaryOutput, { recursive: true });
  packChunks.forEach((chunks, index) =>
    fs.writeFileSync(
      path.join(temporaryOutput, `ranks-${index.toString().padStart(2, "0")}.data`),
      Buffer.concat(chunks),
    ),
  );
  fs.writeFileSync(path.join(temporaryOutput, "lexicon.data"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(temporaryOutput, "README.md"),
    `# Hot and Cold generated data\n\nJudging revision: ${HOT_AND_COLD_LATEST_JUDGING_VERSION}. Run \`pnpm data:hot-and-cold\` to rebuild. The lexicon derives from Open English WordNet 2025 (CC BY 4.0) and SUBTLEX-US frequency data. Rank packs are generated with the bundled Xenova/all-MiniLM-L6-v2 model.\n\nOrdinary distributional word association is the main signal. Intended target and ordinary candidate senses provide supporting evidence, WordNet boosts are capped, and alternative-sense-only matches are penalised.\n`,
  );
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.renameSync(temporaryOutput, OUTPUT_DIR);
  console.log(`wrote ${OUTPUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
