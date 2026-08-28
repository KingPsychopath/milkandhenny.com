import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareGuess } from "./hot-and-cold-rules";

interface HotAndColdManifest {
  aliases: Record<string, string>;
  hints: Record<string, string[]>;
  rankPacks: Record<string, { file: string; offset: number }>;
  version: number;
  words: string[];
}

interface LoadedLexicon {
  index: Map<string, number>;
  manifest: HotAndColdManifest;
}

let lexiconPromise: Promise<LoadedLexicon> | null = null;
const rankPacks = new Map<string, Promise<Uint8Array>>();

function assetPath(file: string) {
  const root =
    process.env.NODE_ENV === "production"
      ? path.join(process.cwd(), ".output", "server", "assets", "hot-and-cold")
      : path.join(process.cwd(), "runtime-assets", "hot-and-cold");
  return path.join(root, file);
}

async function readAsset(file: string) {
  return new Uint8Array(await readFile(assetPath(file)));
}

function parseManifest(bytes: Uint8Array): HotAndColdManifest {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
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
    !("version" in value) ||
    value.version !== 2
  )
    throw new Error("The Hot and Cold lexicon is invalid");
  return value as HotAndColdManifest;
}

async function loadLexicon() {
  lexiconPromise ??= (async () => {
    const manifest = parseManifest(await readAsset("lexicon.data"));
    if (!manifest?.words.length) throw new Error("The Hot and Cold lexicon is unavailable");
    return {
      index: new Map(manifest.words.map((word, index) => [word, index])),
      manifest,
    };
  })();
  return lexiconPromise;
}

async function loadRanks(target: string) {
  const { manifest } = await loadLexicon();
  const location = manifest.rankPacks[target];
  if (!location) throw new Error("The Hot and Cold rank table is unavailable");
  let pending = rankPacks.get(location.file);
  if (!pending) {
    pending = (async () => {
      try {
        return await readAsset(location.file);
      } catch {
        throw new Error("The Hot and Cold rank pack is unavailable");
      }
    })();
    rankPacks.set(location.file, pending);
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

export async function resolveHotAndColdGuess(raw: string) {
  const prepared = prepareGuess(raw);
  if (!prepared) return null;
  const { index, manifest } = await loadLexicon();
  const word = manifest.aliases[prepared] ?? (index.has(prepared) ? prepared : undefined);
  if (!word || !index.has(word)) return null;
  return word;
}

export async function rankHotAndColdWord(target: string, word: string) {
  const [{ index }, ranks] = await Promise.all([loadLexicon(), loadRanks(target)]);
  const wordIndex = index.get(word);
  if (wordIndex === undefined || wordIndex >= ranks.length)
    throw new Error("That word is not in the Hot and Cold dictionary");
  return ranks[wordIndex];
}

export async function hotAndColdHint(
  target: string,
  hintIndex: number,
  excluded: readonly string[],
) {
  const { manifest } = await loadLexicon();
  const candidates = manifest.hints[target];
  if (!candidates?.length) throw new Error("No hint is available for this word");
  const excludedWords = new Set(excluded);
  const start = Math.min(Math.max(0, hintIndex), candidates.length - 1);
  const word = candidates.slice(start).find((candidate) => !excludedWords.has(candidate));
  if (!word) throw new Error("You have used every hint");
  return { word, rank: await rankHotAndColdWord(target, word) };
}
