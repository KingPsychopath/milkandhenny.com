import {
  copyObject,
  deleteObjects,
  listObjects,
} from "@/lib/platform/object-storage-provider-context.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import type { StorageScope } from "@/lib/platform/r2.server";

type DirtyWord = {
  slug: string;
  visibility: "public" | "unlisted" | "private";
  media_source_scope: StorageScope | null;
};

/** Reconcile from the scope that owned media before the visibility change. The DB flag
 * survives a process crash, and the word lock prevents a later edit racing the R2 move. */
export async function runWordMediaReconcileBatch(limit = 10, slug?: string): Promise<number> {
  const candidates = await query<{ slug: string }>(
    `select slug from words where media_scope_dirty and ($1::text is null or slug=$1)
       order by slug limit $2`,
    [slug ?? null, limit],
  );
  let completed = 0;
  for (const candidate of candidates) {
    await transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `word:${candidate.slug}`,
      ]);
      const row = await client.query<DirtyWord>(
        `select slug, visibility, media_source_scope from words
           where slug=$1 and media_scope_dirty for update`,
        [candidate.slug],
      );
      const word = row.rows[0];
      if (!word) return;
      const destinationScope: StorageScope = word.visibility === "private" ? "private" : "public";
      const otherScope: StorageScope = destinationScope === "private" ? "public" : "private";
      const prefix = `words/media/${word.slug}/`;
      const [destination, other] = await Promise.all([
        listObjects(prefix, { scope: destinationScope }),
        listObjects(prefix, { scope: otherScope }),
      ]);
      const existing = new Set(destination.map((object) => object.key));
      for (const object of other) {
        if (word.media_source_scope === otherScope || !existing.has(object.key))
          await copyObject(object.key, object.key, {
            sourceScope: otherScope,
            destinationScope,
          });
      }
      await deleteObjects(
        other.map((object) => object.key),
        { scope: otherScope },
      );
      await client.query(
        `update words set media_scope_dirty=false, media_source_scope=null where slug=$1`,
        [word.slug],
      );
      completed += 1;
    });
  }
  return completed;
}
