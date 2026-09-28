import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  createWord,
  deleteWord,
  getWord,
  getWordMeta,
  inspectWordPersistence,
  listAllWords,
  updateWord,
} from "@/features/words/store.server";
import { WordRevisionConflictError } from "@/features/words/word-postgres.server";
import { runWordMediaReconcileBatch } from "@/features/words/media-reconcile.server";
import { runWordMediaDeletionBatch } from "@/features/words/media-deletions.server";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres words", () => {
  beforeAll(async () => {
    vi.stubEnv("WORD_STORE", "postgres");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate words cascade");
  });

  it("stores Markdown and immutable revisions with the existing word shape", async () => {
    const created = await createWord({
      slug: "first-word",
      title: "First word",
      markdown: "A line\n\nSecond line",
      type: "note",
      visibility: "private",
      tags: [" Jazz ", "jazz"],
    });
    expect(created.meta.revision).toBe(1);
    expect(await getWord(created.meta.slug)).toEqual(created);
    expect((await getWordMeta(created.meta.slug))?.tags).toEqual(["jazz"]);

    const updated = await updateWord(created.meta.slug, {
      markdown: "Changed exactly",
      title: "Changed",
      expectedUpdatedAt: created.meta.updatedAt,
    });
    expect(updated?.meta.revision).toBe(2);
    expect(updated?.markdown).toBe("Changed exactly");
    const revisions = await query<{ revision: number; markdown: string }>(
      "select revision, markdown from word_revisions where slug = $1 order by revision",
      [created.meta.slug],
    );
    expect(revisions).toEqual([
      { revision: 1, markdown: "A line\n\nSecond line" },
      { revision: 2, markdown: "Changed exactly" },
    ]);
    expect((await listAllWords({ includeNonPublic: true })).map(({ slug }) => slug)).toEqual([
      created.meta.slug,
    ]);
    expect((await inspectWordPersistence()).missingBodies).toEqual([]);
    expect(await deleteWord(created.meta.slug)).toBe(true);
    expect(await getWord(created.meta.slug)).toBeNull();
  });

  it("refuses concurrent creates and stale edits without losing the winning revision", async () => {
    const input = { slug: "same-word", title: "Same", markdown: "Original" };
    const creates = await Promise.allSettled([createWord(input), createWord(input)]);
    expect(creates.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(creates.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const original = await getWord(input.slug);
    if (!original) throw new Error("Expected word");
    const edits = await Promise.allSettled([
      updateWord(input.slug, { title: "One" }),
      updateWord(input.slug, { title: "Two" }),
    ]);
    expect(edits.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(
      edits.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof WordRevisionConflictError,
      ),
    ).toHaveLength(1);
    expect((await getWord(input.slug))?.meta.revision).toBe(2);
  });

  it("keeps a newly public word hidden until its media move is durable and retryable", async () => {
    const key = "words/media/moving-word/photo.webp";
    await createWord({
      slug: "moving-word",
      title: "Moving",
      markdown: "Body",
      visibility: "private",
    });
    const changed = await updateWord("moving-word", { visibility: "public" });
    expect(changed?.meta.mediaScopeDirty).toBe(true);
    expect((await listAllWords()).map((word) => word.slug)).not.toContain("moving-word");

    const source = [{ key, size: 1, lastModified: new Date() }];
    const listObjects = vi.fn(async (_prefix: string, options: { scope: string }) =>
      options.scope === "private" ? source : [],
    );
    const copyObject = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValue(undefined);
    const deleteObjects = vi.fn(async () => 1);
    const provider = { ...r2ObjectStorageProvider, listObjects, copyObject, deleteObjects };
    await expect(
      withObjectStorageProvider(provider, () => runWordMediaReconcileBatch(1, "moving-word")),
    ).rejects.toThrow("R2 unavailable");
    expect((await getWordMeta("moving-word"))?.mediaScopeDirty).toBe(true);

    expect(
      await withObjectStorageProvider(provider, () => runWordMediaReconcileBatch(1, "moving-word")),
    ).toBe(1);
    expect(copyObject).toHaveBeenCalledWith(key, key, {
      sourceScope: "private",
      destinationScope: "public",
    });
    expect(deleteObjects).toHaveBeenCalledWith([key], { scope: "private" });
    expect((await getWordMeta("moving-word"))?.mediaScopeDirty).toBe(false);
    expect((await listAllWords()).map((word) => word.slug)).toContain("moving-word");
  });

  it("records word media cleanup before deletion and blocks slug reuse until it completes", async () => {
    const slug = "deleting-word";
    const key = `words/media/${slug}/photo.webp`;
    await createWord({ slug, title: "Deleting", markdown: "Body", visibility: "private" });
    const listObjects = vi.fn(async (_prefix: string, options: { scope: string }) =>
      options.scope === "private" ? [{ key, size: 1, lastModified: new Date() }] : [],
    );
    const deleteObject = vi.fn(async () => undefined);
    const provider = {
      ...r2ObjectStorageProvider,
      isConfigured: () => true,
      listObjects,
      deleteObject,
    };
    expect(await withObjectStorageProvider(provider, () => deleteWord(slug))).toBe(true);
    expect(await getWord(slug)).toBeNull();
    await expect(
      createWord({ slug, title: "New", markdown: "New", visibility: "private" }),
    ).rejects.toThrow("Word media deletion is still in progress");
    const pending = await query<{ target_key: string; status: string }>(
      `select target_key,status from media_object_operations
         where owner_kind='word' and owner_id=$1`,
      [slug],
    );
    expect(pending).toEqual([{ target_key: key, status: "pending" }]);

    const result = await withObjectStorageProvider(provider, () =>
      runWordMediaDeletionBatch("word-delete-test"),
    );
    expect(result.completed).toBe(1);
    expect(deleteObject).toHaveBeenCalledWith(key, { scope: "private" });
    const recreated = await createWord({
      slug,
      title: "New",
      markdown: "New",
      visibility: "private",
    });
    expect(recreated.meta.revision).toBe(2);
  });
});
