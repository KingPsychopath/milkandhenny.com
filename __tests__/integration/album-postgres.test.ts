import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  deleteAlbumManifest,
  listAlbumManifests,
  readAlbumManifest,
  writeAlbumManifest,
} from "@/features/media/album-repository.server";
import { AlbumWriteConflictError } from "@/features/media/album-postgres.server";
import type { Photo } from "@/features/media/albums";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const photo: Photo = {
  id: "photo-1",
  width: 1600,
  height: 1067,
  version: "version-1",
  widths: [480, 960, 1600],
  placeholder: { color: "#5b4636", blurDataUrl: "data:image/jpeg;base64,abc" },
  alt: "A musician on stage",
};

describeWithDatabase("Postgres album manifests", () => {
  beforeAll(async () => {
    vi.stubEnv("ALBUM_STORE", "postgres");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query("truncate gallery_albums cascade");
  });

  it("stores ordered photos and an owned cover while preserving the public shape", async () => {
    const draft = await writeAlbumManifest({
      slug: "jazz-night",
      title: "Jazz Night",
      date: "2026-08-24",
      cover: "",
      photos: [],
      status: "draft",
    });
    expect(draft.revision).toBe(1);
    const published = await writeAlbumManifest({
      ...draft,
      photos: [photo],
      cover: photo.id,
      status: "published",
    });
    expect(published.revision).toBe(2);
    expect(await readAlbumManifest("jazz-night")).toEqual(published);
    expect(await listAlbumManifests()).toEqual([published]);
    await deleteAlbumManifest("jazz-night");
    expect(await readAlbumManifest("jazz-night")).toBeNull();
  });

  it("rejects stale edits and two concurrent creates of one slug", async () => {
    const initial = {
      slug: "same-slug",
      title: "First",
      date: "2026-08-24",
      cover: "",
      photos: [],
      status: "draft" as const,
    };
    const created = await Promise.allSettled([
      writeAlbumManifest(initial),
      writeAlbumManifest({ ...initial, title: "Second" }),
    ]);
    expect(created.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      created.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof AlbumWriteConflictError,
      ),
    ).toHaveLength(1);
    const current = await readAlbumManifest("same-slug");
    if (!current) throw new Error("Expected album");
    const outcomes = await Promise.allSettled([
      writeAlbumManifest({ ...current, title: "Third" }),
      writeAlbumManifest({ ...current, title: "Fourth" }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      outcomes.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof AlbumWriteConflictError,
      ),
    ).toHaveLength(1);
  });

  it("rejects a cover outside its album", async () => {
    const draft = await writeAlbumManifest({
      slug: "cover-owner",
      title: "Cover Owner",
      date: "2026-08-24",
      cover: "",
      photos: [],
      status: "draft",
    });
    await expect(
      writeAlbumManifest({
        ...draft,
        cover: "someone-else",
        photos: [photo],
        status: "published",
      }),
    ).rejects.toThrow("Invalid album");
    await expect(
      query("update gallery_albums set status = 'published', cover_photo_id = $2 where slug = $1", [
        draft.slug,
        "someone-else",
      ]),
    ).rejects.toThrow();
  });
});
