import { extractHeadings } from "@/features/words/headings";
import { getAlbumBySlug } from "@/features/media/albums.server";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import type { EmbeddedAlbum } from "./AlbumEmbed";

async function resolveAlbumsFromWordContent(
  content: string,
): Promise<Record<string, EmbeddedAlbum>> {
  try {
    const albumLinkPattern = /\[.*?\]\(\/pics\/([a-z0-9-]+)(?:#[a-z]+)?\)/g;
    const albums: Record<string, EmbeddedAlbum> = {};
    const slugs = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = albumLinkPattern.exec(content)) !== null) {
      slugs.add(match[1]);
    }

    await Promise.all(
      [...slugs].map(async (albumSlug) => {
        const href = `/pics/${albumSlug}`;
        const album = await getAlbumBySlug(albumSlug);
        if (!album?.photos?.length) return;

        const previewPhotos = [album.photos.find((photo) => photo.id === album.cover)].filter(
          (photo): photo is (typeof album.photos)[number] => Boolean(photo),
        );
        for (const photo of album.photos) {
          if (previewPhotos.length >= 6) break;
          if (photo.id !== album.cover) previewPhotos.push(photo);
        }

        const focalPoints: Record<string, string> = {};
        for (const photo of album.photos) {
          if (photo.focalPoint) {
            focalPoints[photo.id] = focalPresetToObjectPosition(photo.focalPoint);
          } else if (photo.autoFocal) {
            focalPoints[photo.id] = `${photo.autoFocal.x}% ${photo.autoFocal.y}%`;
          }
        }

        albums[href] = {
          slug: album.slug,
          title: album.title,
          date: album.date,
          cover: album.cover,
          photoCount: album.photos.length,
          previewPhotos,
          focalPoints: Object.keys(focalPoints).length > 0 ? focalPoints : undefined,
        };
      }),
    );

    return albums;
  } catch {
    return {};
  }
}

type WordRenderData = {
  headings: ReturnType<typeof extractHeadings>;
  albums: Record<string, EmbeddedAlbum>;
};

const cache = new Map<string, Promise<WordRenderData>>();
const MAX_CACHE_ENTRIES = 256;

async function getWordRenderData(
  slug: string,
  updatedAt: string,
  markdown: string,
): Promise<WordRenderData> {
  const key = `${slug}:${updatedAt}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const value = resolveAlbumsFromWordContent(markdown).then((albums) => ({
    headings: extractHeadings(markdown),
    albums,
  }));
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
  return value;
}

export { getWordRenderData };
