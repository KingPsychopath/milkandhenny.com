import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";

import { finalizeAlbumUploads, updateAlbumMetadata } from "@/features/media/admin-albums";
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

  it("serializes a public delete with republishing the same object key", async () => {
    const key = `albums/${album.slug}/og/photo-1.jpg`;
    await writePostgresAlbum(
      { ...album, status: "draft", revision: 1 },
      {
        publicDeleteKeys: [key],
      },
    );
    let beginDelete!: () => void;
    const deleting = new Promise<void>((resolve) => {
      beginDelete = resolve;
    });
    let finishDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const worker = withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        deleteObject: vi.fn(async () => {
          beginDelete();
          await deleteGate;
        }),
      },
      () => runAlbumObjectDeletionBatch("album-delete-lock-test"),
    );
    await deleting;
    const draft = await readPostgresAlbum(album.slug);
    let published = false;
    const republish = writePostgresAlbum({ ...draft!, status: "published" }).then(() => {
      published = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(published).toBe(false);
    finishDelete();
    await expect(worker).resolves.toMatchObject({ completed: 1 });
    await republish;
    expect(published).toBe(true);
  });

  it("commits upload finalization and unpublication before public object cleanup", async () => {
    const image = await sharp({
      create: { width: 80, height: 80, channels: 3, background: "#67422b" },
    })
      .jpeg()
      .toBuffer();
    const removeMany = vi.fn(async () => 0);
    const result = await withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        headObject: vi.fn(async () => ({ exists: true, size: image.byteLength })),
        downloadBuffer: vi.fn(async () => image),
        uploadBuffer: vi.fn(async () => {}),
        deleteObjects: removeMany,
      },
      () =>
        finalizeAlbumUploads(album.slug, [
          {
            original: "new.jpg",
            photoId: "new",
            uploadKey: `incoming/albums/${album.slug}/new.jpg`,
          },
        ]),
    );
    expect(result.album.status).toBe("draft");
    expect(result.album.photos).toHaveLength(2);
    expect(removeMany).toHaveBeenCalledOnce();
    expect(removeMany).toHaveBeenCalledWith([`incoming/albums/${album.slug}/new.jpg`], {
      scope: "private",
    });
    const operations = await query<{ target_key: string }>(
      `select target_key from media_object_operations where owner_kind='album' and owner_id=$1`,
      [album.slug],
    );
    expect(operations).toHaveLength(3);
  });
});
