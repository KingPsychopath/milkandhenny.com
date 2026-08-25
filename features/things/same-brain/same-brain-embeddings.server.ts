import path from "node:path";
import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { sameBrainVectorKey } from "./same-brain-keys";

/**
 * The one place a model is involved.
 *
 * Its entire job is to answer "did these two people give the same answer" for pairs that differ in
 * spelling rather than meaning — sea/ocean, knife/cutlery, bin/rubbish bin. It never ranks players,
 * never picks who is odd, and never decides a round on its own. That containment is deliberate:
 * cosine distance measures which words keep company, not the axis a question opened up, so a model
 * asked to judge "name something cold" would confidently exile *breakup* — the best answer in the
 * room. Asked only whether two words are the same word, it is reliable.
 *
 * Everything here degrades. If the model will not load, if the cache is cold and the process is
 * busy, if a word is unembeddable — the caller gets nothing and scores on spelling alone, which is
 * a complete ruleset in its own right.
 */

const MODEL = "Xenova/all-MiniLM-L6-v2";
/** Quantised: ~23MB on disk, single-digit milliseconds per word, and no measurable quality cost at this job. */
const DTYPE = "q8";
const VECTOR_TTL_SECONDS = 30 * 24 * 60 * 60;
const EMBED_TIMEOUT_MS = 4_000;
const MAX_LOCAL_VECTORS = 4_096;

type Extractor = (
  text: string | string[],
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ data: ArrayLike<number> } | ArrayLike<number>>;

let extractorPromise: Promise<Extractor | null> | null = null;
/** Process-local, in front of Redis. A round asks about the same handful of words repeatedly. */
const localVectors = new Map<string, Float32Array>();

function cacheLocalVector(word: string, vector: Float32Array): void {
  localVectors.delete(word);
  localVectors.set(word, vector);
  while (localVectors.size > MAX_LOCAL_VECTORS) {
    const oldest = localVectors.keys().next().value;
    if (oldest === undefined) break;
    localVectors.delete(oldest);
  }
}

/**
 * Off switch for operations, independent of any room's house rules.
 *
 * The lobby toggle is the one players use, per room. This is the one you reach for when the model is
 * misbehaving across every room at once and you would rather every game quietly scored on exact
 * matches than reason about it: set `SAME_BRAIN_EMBEDDINGS=off` and restart. Nothing else changes —
 * rooms still offer the setting, it just resolves to the same scoring either way.
 */
function embeddingsDisabled() {
  return (process.env.SAME_BRAIN_EMBEDDINGS ?? "").toLowerCase() === "off";
}

/**
 * Loaded once, lazily, and never retried on failure within a process.
 *
 * Not retrying is the point: a missing model file or an incompatible runtime does not become
 * available because a second round asked. One warning, then the game runs on exact matches.
 */
function loadExtractor() {
  extractorPromise ??= (async () => {
    if (embeddingsDisabled()) {
      log.info(
        "things.same-brain",
        "Embeddings disabled by environment; scoring on exact matches",
        {
          model: MODEL,
        },
      );
      return null;
    }
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      /**
       * Vendored weights only — never the Hugging Face CDN, and never transformers.js's own download
       * cache, in any environment.
       *
       * `pnpm model:same-brain` puts the files in `models/`, and the Dockerfile runs it during the
       * build so the runtime image carries them. All three of these lines matter:
       *
       * - `allowRemoteModels: false` keeps a live round from depending on a third party being up.
       * - `useFSCache: false` because that cache lives *inside the transformers package* under
       *   node_modules, so a machine that once downloaded the model keeps working after the vendored
       *   copy is gone. That is precisely the mistake this is meant to catch: development would pass
       *   while production, whose image contains no node_modules cache, silently lost the feature.
       * - an absolute `localModelPath`, because the default is relative to the working directory and
       *   the server is not always started from the repository root.
       *
       * With the files absent this throws, is caught below, and the game scores on exact matches.
       */
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.useFSCache = false;
      env.localModelPath = path.join(process.cwd(), "models");
      const extractor = (await pipeline("feature-extraction", MODEL, {
        dtype: DTYPE,
      })) as unknown as Extractor;
      log.info("things.same-brain", "Embedding model ready", { model: MODEL });
      return extractor;
    } catch (cause) {
      log.warn("things.same-brain", "Embedding model unavailable; scoring on exact matches", {
        model: MODEL,
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return null;
    }
  })();
  return extractorPromise;
}

function toVector(output: Awaited<ReturnType<Extractor>>): Float32Array | null {
  const data = "data" in output ? output.data : output;
  if (!data || typeof data.length !== "number" || data.length === 0) return null;
  return Float32Array.from(data as ArrayLike<number>);
}

async function readCachedVector(word: string) {
  const local = localVectors.get(word);
  if (local) {
    cacheLocalVector(word, local);
    return local;
  }
  const redis = getRedis();
  if (!redis) return null;
  try {
    const stored = await redis.get<number[]>(sameBrainVectorKey(MODEL, word));
    if (!Array.isArray(stored) || stored.length === 0) return null;
    const vector = Float32Array.from(stored);
    cacheLocalVector(word, vector);
    return vector;
  } catch {
    return null;
  }
}

async function writeCachedVector(word: string, vector: Float32Array) {
  cacheLocalVector(word, vector);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(sameBrainVectorKey(MODEL, word), [...vector], { ex: VECTOR_TTL_SECONDS });
  } catch {
    // A cache that will not write is a slower game, not a broken one.
  }
}

/** Vectors are stored already normalised, so agreement is a dot product. */
function cosine(a: Float32Array, b: Float32Array) {
  if (a.length !== b.length) return 0;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += a[index] * b[index];
  return Math.max(-1, Math.min(1, total));
}

/**
 * Embeds every word once, then hands back a synchronous, symmetric similarity function.
 *
 * The two-step shape is what keeps the rules pure: all the awaiting happens here, and
 * `scoreRound` receives something it can call in a loop without knowing a model exists. Returns
 * null when there is nothing usable, which the caller reads as "score on spelling".
 */
export async function sameBrainSimilarity(
  words: string[],
): Promise<((a: string, b: string) => number) | null> {
  const unique = [...new Set(words.filter((word) => word.length > 0))];
  if (unique.length < 2) return null;

  const vectors = new Map<string, Float32Array>();
  const missing: string[] = [];
  for (const word of unique) {
    const cached = await readCachedVector(word);
    if (cached) vectors.set(word, cached);
    else missing.push(word);
  }

  if (missing.length > 0) {
    const extractor = await loadExtractor();
    if (!extractor) return vectors.size < 2 ? null : lookup(vectors);
    // Cleared in `finally`, or a timer outlives the round and holds a script open after it is done.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const embedded = await Promise.race([
        Promise.all(
          missing.map(async (word) => {
            const output = await extractor(word, { pooling: "mean", normalize: true });
            return [word, toVector(output)] as const;
          }),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("embedding timed out")), EMBED_TIMEOUT_MS);
        }),
      ]);
      for (const [word, vector] of embedded) {
        if (!vector) continue;
        vectors.set(word, vector);
        await writeCachedVector(word, vector);
      }
    } catch (cause) {
      // Partial results are still useful: whatever came out of the cache can score.
      log.warn("things.same-brain", "Embedding failed mid-round", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return vectors.size < 2 ? null : lookup(vectors);
}

/**
 * A word with no vector is similar to nothing, so an unembeddable answer never merges by accident.
 * Identical strings short-circuit to 1 — they are the same answer whatever the model thinks.
 */
function lookup(vectors: Map<string, Float32Array>) {
  return (a: string, b: string) => {
    if (a === b) return 1;
    const left = vectors.get(a);
    const right = vectors.get(b);
    if (!left || !right) return 0;
    return cosine(left, right);
  };
}

/** Development and the calibration script only, so a sweep does not pay for a warm-up per threshold. */
export async function sameBrainEmbeddingReady() {
  return (await loadExtractor()) !== null;
}
