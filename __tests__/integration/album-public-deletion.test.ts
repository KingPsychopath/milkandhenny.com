import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { updateAlbumMetadata } from "@/features/media/admin-albums";
import { runAlbumObjectDeletionBatch } from "@/features/media/album-object-deletions.server";
import { readPostgresAlbum, writePostgresAlbum } from "@/features/media/album-postgres.server";
import type { Album } from "@/features/media/albums";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const album: Album = {
  slug: "unpublish-recovery",
  title: "Unpublish recovery",
  date: "2026-09-20",
  cover: "photo-1",
  status: "published",
  photos: [
    {
      id: "photo-1",
      width: 480,
      height: 320,
      version: "v1",
      widths: [480],
      placeholder: { color: "#5b4636" },
    },
  ],
};

describeWithDatabase("Postgres album public deletion", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("ALBUM_STORE", "postgres");
    await query("truncate gallery_albums cascade");
    await query("truncate media_object_operations");
    await writePostgresAlbum(album);
  });

  it("commits draft state with deletion intents and blocks republishing until cleanup", async () => {
    const remove = vi.fn(async () => {});
    const updated = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      () => updateAlbumMetadata(album.slug, { status: "draft" }),
    );
    expect(updated.status).toBe("draft");
    expect(remove).not.toHaveBeenCalled();
    const pending = await query<{ target_key: string; status: string }>(
      `select target_key,status from media_object_operations
        where owner_kind='album' and owner_id=$1 order by target_key`,
      [album.slug],
    );
    expect(pending).toHaveLength(3);
    expect(pending.every((operation) => operation.status === "pending")).toBe(true);
    await expect(updateAlbumMetadata(album.slug, { status: "published" })).rejects.toThrow(
      "cleanup is still pending",
    );
    const deleted = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      () => runAlbumObjectDeletionBatch("album-delete-test"),
    );
    expect(deleted).toEqual({ claimed: 3, completed: 3, retried: 0, lostClaim: 0 });
    expect(remove).toHaveBeenCalledTimes(3);
    const republished = await withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        downloadBuffer: vi.fn(async () => Buffer.from("image")),
        uploadBuffer: vi.fn(async () => {}),
      },
      () => updateAlbumMetadata(album.slug, { status: "published" }),
    );
    expect(republished.status).toBe("published");
    expect((await readPostgresAlbum(album.slug))?.status).toBe("published");
  });

  it("retains failed deletes for retry after an uncertain R2 result", async () => {
    await updateAlbumMetadata(album.slug, { status: "draft" });
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValue(undefined);
    await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      async () => {
        expect(await runAlbumObjectDeletionBatch("album-delete-test")).toEqual({
          claimed: 3,
          completed: 2,
          retried: 1,
          lostClaim: 0,
        });
        await query("update media_object_operations set available_at=now() where status='pending'");
        expect(await runAlbumObjectDeletionBatch("album-delete-test")).toEqual({
          claimed: 1,
          completed: 1,
          retried: 0,
          lostClaim: 0,
        });
      },
    );
  });
});
