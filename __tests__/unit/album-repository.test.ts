import { describe, expect, it } from "vitest";

import { parseAlbumManifest } from "@/features/media/album-repository.server";

const photo = {
  id: "photo-1",
  width: 1600,
  height: 1067,
  version: "version-1",
  widths: [480, 960, 1600],
  placeholder: { color: "#5b4636", blurDataUrl: "data:image/jpeg;base64,abc" },
};

describe("album manifest parsing", () => {
  it("accepts a complete responsive album manifest", () => {
    const album = parseAlbumManifest(
      JSON.stringify({
        slug: "jazz-night",
        title: "Jazz Night",
        date: "2026-08-24",
        description: "A warm room.",
        cover: photo.id,
        photos: [{ ...photo, alt: "A musician on stage", focalPoint: "top" }],
        status: "published",
      }),
      "jazz-night",
    );

    expect(album?.photos[0]?.placeholder.color).toBe("#5b4636");
  });

  it.each([
    ["wrong object key", { slug: "another-night" }],
    ["missing dominant colour", { photos: [{ ...photo, placeholder: {} }] }],
    ["duplicate photo IDs", { photos: [photo, photo] }],
    ["missing cover photo", { cover: "absent" }],
    ["empty published album", { cover: "", photos: [] }],
  ])("rejects %s", (_label, override) => {
    const raw = JSON.stringify({
      slug: "jazz-night",
      title: "Jazz Night",
      date: "2026-08-24",
      cover: photo.id,
      photos: [photo],
      status: "published",
      ...override,
    });

    expect(parseAlbumManifest(raw, "jazz-night")).toBeNull();
  });
});
