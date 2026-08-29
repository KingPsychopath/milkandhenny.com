import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  HOT_AND_COLD_ASSET_SCHEMA_VERSION,
  type HotAndColdJudgingVersion,
  prepareGuess,
} from "./hot-and-cold-rules";

interface HotAndColdManifest {
  aliases: Record<string, string>;
  formatVersion: number;
  hints: Record<string, string[]>;
  judgingVersion: string;
  rankPacks: Record<string, { file: string; offset: number }>;
  targetContexts: Record<string, string>;
  targetSenses: Record<string, { definition: string; synset: string }>;
  trails: Record<string, string[]>;
  words: string[];
}

interface LoadedLexicon {
  index: Map<string, number>;
  manifest: HotAndColdManifest;
}

const lexicons = new Map<HotAndColdJudgingVersion, Promise<LoadedLexicon>>();
const rankPacks = new Map<string, Promise<Uint8Array>>();

function assetPath(judgingVersion: HotAndColdJudgingVersion, file: string) {
  const root =
    process.env.NODE_ENV === "production"
      ? path.join(process.cwd(), ".output", "server", "assets", "hot-and-cold")
      : path.join(process.cwd(), "runtime-assets", "hot-and-cold");
  return path.join(root, judgingVersion, file);
}

async function readAsset(judgingVersion: HotAndColdJudgingVersion, file: string) {
  return new Uint8Array(await readFile(assetPath(judgingVersion, file)));
}

function parseManifest(
  bytes: Uint8Array,
  judgingVersion: HotAndColdJudgingVersion,
): HotAndColdManifest {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const expectedFormatVersion = judgingVersion === "1.0.0" ? 3 : HOT_AND_COLD_ASSET_SCHEMA_VERSION;
  if (
    typeof value !== "object" ||
    value === null ||
    !("words" in value) ||
    !Array.isArray(value.words) ||
    !("aliases" in value) ||
    typeof value.aliases !== "object" ||
    value.aliases === null ||
    !("hints" in value) ||
    typeof value.hints !== "object" ||
    value.hints === null ||
    !("rankPacks" in value) ||
    typeof value.rankPacks !== "object" ||
    value.rankPacks === null ||
    !("targetSenses" in value) ||
    typeof value.targetSenses !== "object" ||
    value.targetSenses === null ||
    !("targetContexts" in value) ||
    typeof value.targetContexts !== "object" ||
    value.targetContexts === null ||
    !("trails" in value) ||
    typeof value.trails !== "object" ||
    value.trails === null ||
    !("formatVersion" in value) ||
    value.formatVersion !== expectedFormatVersion ||
    !("judgingVersion" in value) ||
    value.judgingVersion !== judgingVersion
  )
    throw new Error("The Hot and Cold lexicon is invalid");
  return value as HotAndColdManifest;
}

async function loadLexicon(judgingVersion: HotAndColdJudgingVersion) {
  let pending = lexicons.get(judgingVersion);
  if (!pending) {
    pending = (async () => {
      const manifest = parseManifest(
        await readAsset(judgingVersion, "lexicon.data"),
        judgingVersion,
      );
      if (!manifest.words.length) throw new Error("The Hot and Cold lexicon is unavailable");
      const words = new Set(manifest.words);
      if (
        Object.entries(manifest.aliases).some(
          ([form, canonical]) => words.has(form) || !words.has(canonical),
        )
      )
        throw new Error("The Hot and Cold aliases are ambiguous");
      return {
        index: new Map(manifest.words.map((word, index) => [word, index])),
        manifest,
      };
    })();
    lexicons.set(judgingVersion, pending);
  }
  return pending;
}

async function loadRanks(target: string, judgingVersion: HotAndColdJudgingVersion) {
  const { manifest } = await loadLexicon(judgingVersion);
  const location = manifest.rankPacks[target];
  if (!location) throw new Error("The Hot and Cold rank table is unavailable");
  const key = `${judgingVersion}:${location.file}`;
  let pending = rankPacks.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        return await readAsset(judgingVersion, location.file);
      } catch {
        throw new Error("The Hot and Cold rank pack is unavailable");
      }
    })();
    rankPacks.set(key, pending);
  }
  const pack = await pending;
  const byteLength = manifest.words.length * Uint16Array.BYTES_PER_ELEMENT;
  if (
    location.offset < 0 ||
    location.offset % Uint16Array.BYTES_PER_ELEMENT !== 0 ||
    location.offset + byteLength > pack.byteLength
  )
    throw new Error("The Hot and Cold rank pack is invalid");
  return new Uint16Array(pack.buffer, pack.byteOffset + location.offset, manifest.words.length);
}

export async function resolveHotAndColdGuess(
  raw: string,
  judgingVersion: HotAndColdJudgingVersion,
) {
  const prepared = prepareGuess(raw);
  if (!prepared) return null;
  const { index, manifest } = await loadLexicon(judgingVersion);
  const word = index.has(prepared) ? prepared : manifest.aliases[prepared];
  if (!word || !index.has(word)) return null;
  return word;
}

export async function rankHotAndColdWord(
  target: string,
  word: string,
  judgingVersion: HotAndColdJudgingVersion,
) {
  const [{ index }, ranks] = await Promise.all([
    loadLexicon(judgingVersion),
    loadRanks(target, judgingVersion),
  ]);
  const wordIndex = index.get(word);
  if (wordIndex === undefined || wordIndex >= ranks.length)
    throw new Error("That word is not in the Hot and Cold dictionary");
  return ranks[wordIndex];
}

export async function hotAndColdHint(
  target: string,
  hintIndex: number,
  excluded: readonly string[],
  judgingVersion: HotAndColdJudgingVersion,
) {
  const { manifest } = await loadLexicon(judgingVersion);
  const candidates = manifest.hints[target];
  if (!candidates?.length) throw new Error("No hint is available for this word");
  const excludedWords = new Set(excluded);
  const start = Math.min(Math.max(0, hintIndex), candidates.length - 1);
  const word = candidates.slice(start).find((candidate) => !excludedWords.has(candidate));
  if (!word) throw new Error("You have used every hint");
  return { word, rank: await rankHotAndColdWord(target, word, judgingVersion) };
}
