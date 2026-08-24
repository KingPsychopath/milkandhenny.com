import path from "node:path";
import { log } from "@/lib/platform/logger.server";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DTYPE = "q8";
const EMBED_TIMEOUT_MS = 4_000;

type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: true },
) => Promise<{ data: ArrayLike<number> } | ArrayLike<number>>;

let extractorPromise: Promise<Extractor | null> | null = null;
const vectors = new Map<string, Float32Array>();

function loadExtractor() {
  extractorPromise ??= (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = true;
      env.allowRemoteModels = false;
      env.useFSCache = false;
      env.localModelPath = path.join(process.cwd(), "models");
      return (await pipeline("feature-extraction", MODEL, {
        dtype: DTYPE,
      })) as unknown as Extractor;
    } catch (cause) {
      log.warn("things.semantic", "Semantic model unavailable", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      return null;
    }
  })();
  return extractorPromise;
}

function outputVector(output: Awaited<ReturnType<Extractor>>) {
  const data = "data" in output ? output.data : output;
  return data.length > 0 ? Float32Array.from(data) : null;
}

async function vectorFor(word: string) {
  const cached = vectors.get(word);
  if (cached) return cached;
  const extractor = await loadExtractor();
  if (!extractor) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      extractor(word, { pooling: "mean", normalize: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("embedding timed out")), EMBED_TIMEOUT_MS);
      }),
    ]);
    const vector = outputVector(output);
    if (vector) vectors.set(word, vector);
    return vector;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function semanticSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const [a, b] = await Promise.all([vectorFor(left), vectorFor(right)]);
  if (!a || !b || a.length !== b.length) return null;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += a[index] * b[index];
  return Math.max(-1, Math.min(1, total));
}
