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
import { HOT_AND_COLD_TARGETS } from "../features/things/hot-and-cold/hot-and-cold-words.server";
import { normaliseGameWord } from "../features/things/shared/word-normalization";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, ".artifacts", "hot-and-cold");
const SOURCE_FILE = path.join(SOURCE_DIR, "english-wordnet-2025.xml.gz");
const OUTPUT_DIR = path.join(ROOT, "assets", "hot-and-cold");
const RANK_DIR = path.join(OUTPUT_DIR, "ranks");
const WORDNET_URL = "https://en-word.net/static/english-wordnet-2025.xml.gz";
const MODEL = "Xenova/all-MiniLM-L6-v2";
const BATCH_SIZE = 256;
const MIN_FREQUENCY = 2;

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
  synsets: Set<string>;
}

interface Manifest {
  aliases: Record<string, string>;
  hints: Record<string, string[]>;
  source: {
    embeddingModel: string;
    frequencyList: string;
    wordnet: string;
  };
  version: number;
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
  return decoded === decoded.toLocaleLowerCase("en-GB") ? cleanWord(decoded) : null;
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
      synsets: new Set<string>(),
    };
    if (partOfSpeech) current.partsOfSpeech.add(partOfSpeech);
    for (const sense of body.matchAll(/<Sense\b[^>]*synset="([^"]+)"/g))
      current.synsets.add(sense[1]);
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

  for (const word of lexical.values())
    word.definitions = [...word.synsets]
      .map((id) => synsetDefinitions.get(id))
      .filter((definition): definition is string => Boolean(definition))
      .slice(0, 3);
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
  const aliasCandidates = new Map<string, Set<string>>();
  const addAlias = (form: string, lemma: string) => {
    if (form === lemma || targetWords.has(form)) return;
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

function relatedWords(
  target: string,
  lexical: Map<string, LexicalWord>,
  synsetNeighbours: Map<string, Set<string>>,
) {
  const targetSynsets = lexical.get(target)?.synsets ?? new Set<string>();
  const directSynsets = new Set<string>();
  for (const synset of targetSynsets)
    for (const neighbour of synsetNeighbours.get(synset) ?? []) directSynsets.add(neighbour);
  return { targetSynsets, directSynsets };
}

function sharesAny(left: Set<string>, right: Set<string>) {
  for (const item of left) if (right.has(item)) return true;
  return false;
}

function contextualText(word: string, lexical: Map<string, LexicalWord>, definitionLimit = 3) {
  const definitions = lexical.get(word)?.definitions ?? [];
  return definitions.length ? `${word}: ${definitions.slice(0, definitionLimit).join("; ")}` : word;
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
  const rawTargets = (await extractor(targetWords, {
    pooling: "mean",
    normalize: true,
  })) as Tensor;
  const contextTargets = (await extractor(
    targetWords.map((word) => contextualText(word, lexical, 1)),
    { pooling: "mean", normalize: true },
  )) as Tensor;
  const rawTargetT = rawTargets.transpose(1, 0);
  const contextTargetT = contextTargets.transpose(1, 0);
  const scores = targetWords.map(() => new Float32Array(words.length));
  const relations = targetWords.map((target) => relatedWords(target, lexical, synsetNeighbours));

  for (let start = 0; start < words.length; start += BATCH_SIZE) {
    const batch = words.slice(start, start + BATCH_SIZE);
    const raw = (await extractor(batch, { pooling: "mean", normalize: true })) as Tensor;
    const context = (await extractor(
      batch.map((word) => contextualText(word, lexical)),
      { pooling: "mean", normalize: true },
    )) as Tensor;
    const rawScores = await matmul(raw, rawTargetT);
    const contextScores = await matmul(context, contextTargetT);
    for (let row = 0; row < batch.length; row += 1) {
      const rawRow = tensorRow(rawScores.data, row, targetWords.length);
      const contextRow = tensorRow(contextScores.data, row, targetWords.length);
      const word = batch[row];
      const wordSynsets = lexical.get(word)?.synsets ?? new Set<string>();
      for (let targetIndex = 0; targetIndex < targetWords.length; targetIndex += 1) {
        const target = targetWords[targetIndex];
        const related = relations[targetIndex];
        const synonymous = sharesAny(wordSynsets, related.targetSynsets);
        const directlyRelated = sharesAny(wordSynsets, related.directSynsets);
        const substringArtifact =
          !synonymous &&
          !directlyRelated &&
          Math.min(word.length, target.length) >= 3 &&
          (word.includes(target) || target.includes(word));
        scores[targetIndex][start + row] =
          rawRow[targetIndex] * 0.48 +
          contextRow[targetIndex] * 0.52 +
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
  const bands = [
    [80, 120],
    [25, 60],
    [5, 20],
  ] as const;
  const hints = bands.map(([minimum, maximum]) => {
    const candidates = order
      .slice(minimum, Math.min(maximum, order.length))
      .map((index) => words[index])
      .filter(
        (word) =>
          word !== target &&
          !word.includes(target) &&
          !target.includes(word) &&
          word.length >= 4 &&
          (lexical.get(word)?.frequency ?? 0) >= 20,
      );
    return candidates[0] ?? words[order[Math.min(minimum, order.length - 1)]];
  });
  return { hints, ranks };
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
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(RANK_DIR, { recursive: true });
  const hints: Record<string, string[]> = {};
  HOT_AND_COLD_TARGETS.forEach((target, index) => {
    const result = rankAndHints(target, words, scores[index], lexical);
    hints[target] = result.hints;
    fs.writeFileSync(path.join(RANK_DIR, `${target}.bin`), Buffer.from(result.ranks.buffer));
  });
  const manifest: Manifest = {
    aliases,
    hints,
    source: {
      embeddingModel: MODEL,
      frequencyList: "SUBTLEX-US via subtlex-word-frequencies 2.0.0",
      wordnet: "Open English WordNet 2025",
    },
    version: 1,
    words,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "lexicon.data"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "README.md"),
    "# Hot and Cold generated data\n\nRun `pnpm data:hot-and-cold` to rebuild. The lexicon derives from Open English WordNet 2025 (CC BY 4.0) and SUBTLEX-US frequency data. Rank files are generated with the bundled Xenova/all-MiniLM-L6-v2 model.\n",
  );
  console.log(`wrote ${OUTPUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
