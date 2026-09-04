import { createHash } from "node:crypto";
import {
  createWord,
  getWord,
  getWordMeta,
  inspectWordPersistence,
  listAllWords,
} from "./store.server";
import { isWordVisibility, type WordRecord } from "./content-types";
import { isWordType } from "./types";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function exportWordArchive(): Promise<string> {
  const inspection = await inspectWordPersistence();
  if (inspection.unindexed.length || inspection.dangling.length || inspection.missingBodies.length)
    throw new Error("Word persistence is inconsistent; run inspect:words and repair before backup");
  const records: WordRecord[] = [];
  for (const meta of await listAllWords({ includeNonPublic: true })) {
    const record = await getWord(meta.slug);
    if (!record) throw new Error(`Missing body for ${meta.slug}; backup is incomplete`);
    records.push(record);
  }
  const payload = JSON.stringify({ createdAt: new Date().toISOString(), records });
  return JSON.stringify({ format: "mah-words-v1", sha256: digest(payload), payload });
}

export function parseWordArchive(raw: string): WordRecord[] {
  const archive = JSON.parse(raw);
  if (
    archive.format !== "mah-words-v1" ||
    typeof archive.payload !== "string" ||
    digest(archive.payload) !== archive.sha256
  )
    throw new Error("Word archive checksum or format is invalid");
  const records = JSON.parse(archive.payload).records as WordRecord[];
  if (!Array.isArray(records)) throw new Error("Word archive records are invalid");
  const slugs = new Set<string>();
  for (const record of records) {
    const meta = record?.meta;
    if (
      !meta ||
      typeof meta.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug) ||
      slugs.has(meta.slug) ||
      typeof meta.title !== "string" ||
      !meta.title.trim() ||
      !isWordVisibility(meta.visibility) ||
      !isWordType(meta.type) ||
      typeof record.markdown !== "string" ||
      !Array.isArray(meta.tags) ||
      meta.tags.some((tag) => typeof tag !== "string") ||
      !Number.isFinite(Date.parse(meta.createdAt)) ||
      !Number.isFinite(Date.parse(meta.updatedAt)) ||
      typeof meta.bodyKey !== "string" ||
      !meta.bodyKey.startsWith(`words/${meta.type}/${meta.slug}/`) ||
      meta.bodyKey.includes("..")
    )
      throw new Error("Word archive contains invalid or duplicate metadata");
    slugs.add(meta.slug);
  }
  return records;
}

/** Preflight every record before writing. Restore into isolated empty metadata and object storage. */
export async function restoreWordArchive(raw: string): Promise<number> {
  const records = parseWordArchive(raw);
  const inspection = await inspectWordPersistence();
  if (inspection.records || inspection.dangling.length)
    throw new Error("Word restore requires empty target metadata");
  for (const { meta } of records) {
    if (await getWordMeta(meta.slug))
      throw new Error(`Existing metadata for ${meta.slug}; repair its index before restoring`);
  }
  for (const { meta, markdown } of records) await createWord({ ...meta, markdown });
  return records.length;
}
