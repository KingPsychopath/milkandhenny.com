import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { auditPostgresAlbumObjects } from "@/features/media/album-object-audit.server";
import { writePostgresAlbum } from "@/features/media/album-postgres.server";
import type { Album } from "@/features/media/albums";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const album: Album = {
  slug: "source-audit-album",
  title: "Source audit",
  date: "2026-09-20",
  cover: "photo-1",
  status: "published",
  photos: [
    {
      id: "photo-1",
      width: 480,
      height: 320,
      version: "version-1",
      widths: [480],
      size: 12,
      placeholder: { color: "#5b4636" },
    },
  ],
};

describeWithDatabase("Postgres album object audit", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate gallery_albums cascade");
    await writePostgresAlbum(album);
  });

  it("checks private and published public assets without changing metadata", async () => {
    const head = vi.fn(async (key: string, options: { scope: string }) => {
      if (options.scope === "public" && key.endsWith("/og/photo-1.jpg")) return { exists: false };
      return { exists: true, size: key.endsWith("/original/photo-1.jpg") ? 11 : 20 };
    });
    const result = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: head },
      () => auditPostgresAlbumObjects(),
    );
    expect(result).toEqual({
      photosChecked: 1,
      objectsChecked: 7,
      complete: true,
      issues: [
        {
          slug: album.slug,
          photoId: "photo-1",
          scope: "private",
          key: `albums/${album.slug}/original/photo-1.jpg`,
          kind: "size_mismatch",
          expectedBytes: 12,
          actualBytes: 11,
        },
        {
          slug: album.slug,
          photoId: "photo-1",
          scope: "public",
          key: `albums/${album.slug}/og/photo-1.jpg`,
          kind: "missing",
        },
      ],
    });
    expect(head).toHaveBeenCalledTimes(7);
    const stored = await query<{ status: string }>(
      "select status from gallery_albums where slug=$1",
      [album.slug],
    );
    expect(stored).toEqual([{ status: "published" }]);
  });

  it("skips public checks for drafts and fails closed on an incomplete scan", async () => {
    const draft = await query<{ revision: number }>(
      "update gallery_albums set status='draft',cover_photo_id=null where slug=$1 returning revision",
      [album.slug],
    );
    expect(draft).toHaveLength(1);
    const head = vi.fn(async () => ({ exists: true, size: 12 }));
    const result = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: head },
      () => auditPostgresAlbumObjects(),
    );
    expect(result).toMatchObject({
      photosChecked: 1,
      objectsChecked: 4,
      complete: true,
      issues: [],
    });
    await query(
      `insert into gallery_album_photos
         (album_slug,photo_id,position,width,height,version,widths,placeholder)
       values ($1,'photo-2',1,480,320,'version-2',array[480],'{}'::jsonb)`,
      [album.slug],
    );
    const bounded = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: head },
      () => auditPostgresAlbumObjects(1),
    );
    expect(bounded).toMatchObject({ photosChecked: 1, complete: false });
  });

  it("propagates object storage failures", async () => {
    await expect(
      withObjectStorageProvider(
        { ...r2ObjectStorageProvider, headObject: vi.fn().mockRejectedValue(new Error("R2 down")) },
        () => auditPostgresAlbumObjects(),
      ),
    ).rejects.toThrow("R2 down");
  });
});
