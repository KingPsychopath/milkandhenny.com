import type { StorageScope } from "@/lib/platform/r2.server";
import { getWordMeta } from "./store.server";
import type { WordMediaTarget } from "./upload";

async function getWordMediaStorageScope(target: WordMediaTarget): Promise<StorageScope> {
  if (target.scope === "asset") return "public";
  const meta = await getWordMeta(target.slug);
  if (!meta) throw new Error(`Word not found: ${target.slug}`);
  return meta.visibility === "private" ? "private" : "public";
}

export { getWordMediaStorageScope };
