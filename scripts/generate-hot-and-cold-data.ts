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
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";
import { env, matmul, pipeline, type Tensor } from "@huggingface/transformers";
import {
  HOT_AND_COLD_TARGETS,
  HOT_AND_COLD_TARGET_SENSES,
} from "../features/things/hot-and-cold/hot-and-cold-words.server";
import {
  HOT_AND_COLD_ASSET_SCHEMA_VERSION,
  HOT_AND_COLD_JUDGING_VERSION,
} from "../features/things/hot-and-cold/hot-and-cold-rules";
import { normaliseGameWord } from "../features/things/shared/word-normalization";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, ".artifacts", "hot-and-cold");
const SOURCE_FILE = path.join(SOURCE_DIR, "english-wordnet-2025.xml.gz");
const OUTPUT_DIR = path.join(ROOT, "runtime-assets", "hot-and-cold");
const WORDNET_URL = "https://en-word.net/static/english-wordnet-2025.xml.gz";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 256;
const MIN_FREQUENCY = 2;
const RANK_PACK_COUNT = 16;
const RAW_WORD_WEIGHT = 0.2;
const SENSE_CONTEXT_WEIGHT = 0.8;
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
  snowman: ["cold", "winter", "snow"],
  whale: ["ocean", "giant", "mammal"],
  windmill: ["electricity", "wind", "turbine"],
};

const CURATED_TARGET_CONTEXTS: Partial<Record<(typeof HOT_AND_COLD_TARGETS)[number], string>> = {
  mushroom: "an edible fungus with a stalk and cap, used as food and on pizza",
  orchard: "land planted with fruit trees such as apple and pear trees",
  panda: "a black-and-white bear from China that lives in bamboo forest and eats bamboo",
  penguin: "a flightless black-and-white bird that swims and lives in cold Antarctic regions",
  pillow: "a soft cushion that supports your head in bed while sleeping",
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
    candidateSenses: string;
    contextWeight: number;
    rawWordWeight: number;
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
  trails: Record<string, string[]>;
  words: string[];
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

const PART_OF_SPEECH_ORDER = ["n", "a", "s", "v", "r"] as const;

function primarySenses(word: LexicalWord | undefined) {
  if (!word) return [];
  return PART_OF_SPEECH_ORDER.flatMap((partOfSpeech) => {
    const sense = word.senses.find((candidate) => candidate.partOfSpeech === partOfSpeech);
    return sense ? [sense] : [];
  });
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

function sharesAny(left: Set<string>, right: Set<string>) {
  for (const item of left) if (right.has(item)) return true;
  return false;
}

function contextualTexts(word: string, lexical: Map<string, LexicalWord>) {
  const senses = primarySenses(lexical.get(word));
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
  const rawTargets = (await extractor(targetWords, {
    pooling: "mean",
    normalize: true,
  })) as Tensor;
  const contextTargets = (await extractor(
    targetWords.map((target) => targetContext(target, lexical)),
    { pooling: "mean", normalize: true },
  )) as Tensor;
  const rawTargetT = rawTargets.transpose(1, 0);
  const contextTargetT = contextTargets.transpose(1, 0);
  const scores = targetWords.map(() => new Float32Array(words.length));

  for (let start = 0; start < words.length; start += BATCH_SIZE) {
    const batch = words.slice(start, start + BATCH_SIZE);
    const raw = (await extractor(batch, { pooling: "mean", normalize: true })) as Tensor;
    const contexts = batch.map((word) => contextualTexts(word, lexical));
    const flattenedContexts = contexts.flat();
    const context = (await extractor(flattenedContexts, {
      pooling: "mean",
      normalize: true,
    })) as Tensor;
    const rawScores = await matmul(raw, rawTargetT);
    const contextScores = await matmul(context, contextTargetT);
    let contextRow = 0;
    for (let row = 0; row < batch.length; row += 1) {
      const rawRow = tensorRow(rawScores.data, row, targetWords.length);
      const contextualRows = contexts[row].map(() => {
        const values = tensorRow(contextScores.data, contextRow, targetWords.length);
        contextRow += 1;
        return values;
      });
      const word = batch[row];
      const wordSynsets = new Set(primarySenses(lexical.get(word)).map(({ id }) => id));
      for (let targetIndex = 0; targetIndex < targetWords.length; targetIndex += 1) {
        const target = targetWords[targetIndex];
        const related = targetRelations[targetIndex];
        const synonymous = wordSynsets.has(related.targetSense.id);
        const directlyRelated = sharesAny(wordSynsets, related.directSynsets);
        const contextScore = Math.max(...contextualRows.map((values) => values[targetIndex]));
        const substringArtifact =
          !synonymous &&
          !directlyRelated &&
          Math.min(word.length, target.length) >= 3 &&
          (word.includes(target) || target.includes(word));
        scores[targetIndex][start + row] =
          rawRow[targetIndex] * RAW_WORD_WEIGHT +
          contextScore * SENSE_CONTEXT_WEIGHT +
          (synonymous ? 0.32 : directlyRelated ? 0.09 : 0) -
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

function rankAndHints(
  target: string,
  words: string[],
  score: Float32Array,
  lexical: Map<string, LexicalWord>,
  synsetNeighbours: Map<string, Set<string>>,
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
  const curated = CURATED_HINTS[target as (typeof HOT_AND_COLD_TARGETS)[number]];
  if (curated) {
    if (curated.some((word) => !words.includes(word) || word === target))
      throw new Error(`Curated hints are invalid for ${target}: ${curated.join(", ")}`);
    const hints = [...curated].sort(
      (left, right) => ranks[words.indexOf(right)] - ranks[words.indexOf(left)],
    );
    return { hints, ranks, trail: order.slice(0, 20).map((index) => words[index]) };
  }
  const targetSense = selectedTargetSense(target, lexical);
  let frontier = new Set([targetSense.id]);
  const trustedSynsets = new Set(frontier);
  for (let depth = 0; depth < 3; depth += 1) {
    const next = new Set<string>();
    for (const synset of frontier)
      for (const neighbour of synsetNeighbours.get(synset) ?? []) {
        trustedSynsets.add(neighbour);
        next.add(neighbour);
      }
    frontier = next;
  }
  const safeHint = (word: string) =>
    word !== target &&
    !word.includes(target) &&
    !target.includes(word) &&
    word.length >= 4 &&
    (lexical.get(word)?.frequency ?? 0) >= MIN_AUTOMATIC_HINT_FREQUENCY &&
    primarySenses(lexical.get(word)).some(({ id }) => trustedSynsets.has(id));
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
    return { hints: fallback, ranks, trail: order.slice(0, 20).map((index) => words[index]) };
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
  return { hints, ranks, trail: order.slice(0, 20).map((index) => words[index]) };
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
  const scores = await generateRanks(words, lexical, synsetNeighbours);
  const hints: Record<string, string[]> = {};
  const trails: Record<string, string[]> = {};
  const rankPacks: Record<string, { file: string; offset: number }> = {};
  const packChunks = Array.from({ length: RANK_PACK_COUNT }, () => [] as Buffer[]);
  const packLengths = new Uint32Array(RANK_PACK_COUNT);
  HOT_AND_COLD_TARGETS.forEach((target, index) => {
    const result = rankAndHints(target, words, scores[index], lexical, synsetNeighbours);
    hints[target] = result.hints;
    trails[target] = result.trail;
    const packIndex = index % RANK_PACK_COUNT;
    const file = `ranks-${packIndex.toString().padStart(2, "0")}.data`;
    const bytes = Buffer.from(result.ranks.buffer);
    rankPacks[target] = { file, offset: packLengths[packIndex] };
    packChunks[packIndex].push(bytes);
    packLengths[packIndex] += bytes.byteLength;
  });
  if (HINT_CURATION_REQUIRED.size > 0)
    throw new Error(`Curated hints are required for: ${[...HINT_CURATION_REQUIRED].join(", ")}`);
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  packChunks.forEach((chunks, index) =>
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `ranks-${index.toString().padStart(2, "0")}.data`),
      Buffer.concat(chunks),
    ),
  );
  const manifest: Manifest = {
    aliases,
    formatVersion: HOT_AND_COLD_ASSET_SCHEMA_VERSION,
    hints,
    judgingVersion: HOT_AND_COLD_JUDGING_VERSION,
    rankingPolicy: {
      candidateSenses: "most similar primary sense per part of speech",
      contextWeight: SENSE_CONTEXT_WEIGHT,
      rawWordWeight: RAW_WORD_WEIGHT,
      targetSenses: "one reviewed ordinary noun sense and context per target",
    },
    rankPacks,
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
  fs.writeFileSync(path.join(OUTPUT_DIR, "lexicon.data"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "README.md"),
    `# Hot and Cold generated data\n\nJudging revision: ${HOT_AND_COLD_JUDGING_VERSION}. Run \`pnpm data:hot-and-cold\` to rebuild. The lexicon derives from Open English WordNet 2025 (CC BY 4.0) and SUBTLEX-US frequency data. Rank packs are generated with the bundled Xenova/all-MiniLM-L6-v2 model.\n\nThe judging revision uses semantic versioning: major changes alter word identity or ranks, minor changes alter official hints or other game rulings without replacing ranks, and patches are metadata-only. Every player-visible result is attached to the exact revision.\n`,
  );
  console.log(`wrote ${OUTPUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
