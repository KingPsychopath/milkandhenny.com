import type { MetadataRoute } from "next";
import { getAllAlbums } from "@/features/media/albums";
import { BASE_URL } from "@/lib/shared/config";
import { isNotesEnabled } from "@/features/notes/reader";
import { listNotes } from "@/features/notes/store";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const albums = getAllAlbums();
  const publicNotes = isNotesEnabled()
    ? (await listNotes({ includeNonPublic: false, visibility: "public", limit: 500 })).notes
    : [];

  const wordBySlug = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const note of publicNotes) {
    wordBySlug.set(note.slug, {
      url: `${BASE_URL}/words/${note.slug}`,
      lastModified: new Date(note.updatedAt),
      changeFrequency: "monthly",
      priority: note.type === "blog" ? 0.8 : 0.7,
    });
  }

  const albumEntries: MetadataRoute.Sitemap = albums.map((album) => ({
    url: `${BASE_URL}/pics/${album.slug}`,
    lastModified: new Date(album.date + "T00:00:00"),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/pics`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/words`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/party`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/guestlist`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/icebreaker`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/best-dressed`,
      lastModified: new Date("2026-01-16"),
      changeFrequency: "yearly",
      priority: 0.4,
    },
    ...wordBySlug.values(),
    ...albumEntries,
  ];
}
