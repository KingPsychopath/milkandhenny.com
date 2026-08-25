import { useStorage as getStorage } from "nitro/storage";
import { prepareGuess } from "./hot-and-cold-rules";

interface HotAndColdManifest {
  aliases: Record<string, string>;
  hints: Record<string, string[]>;
  version: number;
  words: string[];
}

interface LoadedLexicon {
  index: Map<string, number>;
  manifest: HotAndColdManifest;
}

let lexiconPromise: Promise<LoadedLexicon> | null = null;
const rankTables = new Map<string, Promise<Uint16Array>>();

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
    !("version" in value) ||
    typeof value.version !== "number"
  )
    throw new Error("The Hot and Cold lexicon is invalid");
  return value as HotAndColdManifest;
}

async function loadLexicon() {
  lexiconPromise ??= (async () => {
    const bytes = await getStorage("assets:hot-and-cold").getItemRaw<Uint8Array>("lexicon.data");
    const manifest = bytes ? parseManifest(Uint8Array.from(bytes)) : null;
    if (!manifest?.words.length) throw new Error("The Hot and Cold lexicon is unavailable");
    return {
      index: new Map(manifest.words.map((word, index) => [word, index])),
      manifest,
    };
  })();
  return lexiconPromise;
}

async function loadRanks(target: string) {
  const existing = rankTables.get(target);
  if (existing) return existing;
  const pending = (async () => {
    const bytes = await getStorage("assets:hot-and-cold").getItemRaw<Uint8Array>(
      `ranks/${target}.bin`,
    );
    if (!bytes) throw new Error("The Hot and Cold rank table is unavailable");
    const copy = Uint8Array.from(bytes);
    return new Uint16Array(copy.buffer);
  })();
  rankTables.set(target, pending);
  return pending;
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
