import { extractHeadings } from "@/features/words/headings";
import { getAlbumBySlug } from "@/features/media/albums.server";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import type { EmbeddedAlbum } from "./AlbumEmbed";

function resolveAlbumsFromWordContent(content: string): Record<string, EmbeddedAlbum> {
  try {
    const albumLinkPattern = /\[.*?\]\(\/pics\/([a-z0-9-]+)(?:#[a-z]+)?\)/g;
    const albums: Record<string, EmbeddedAlbum> = {};
    let match: RegExpExecArray | null;

    while ((match = albumLinkPattern.exec(content)) !== null) {
      const albumSlug = match[1];
      const href = `/pics/${albumSlug}`;
      if (albums[href]) continue;

      const album = getAlbumBySlug(albumSlug);
      if (!album?.photos?.length) continue;

      const previewIds = [album.cover];
      for (const photo of album.photos) {
        if (previewIds.length >= 6) break;
        if (photo.id !== album.cover) previewIds.push(photo.id);
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
        previewIds,
        focalPoints: Object.keys(focalPoints).length > 0 ? focalPoints : undefined,
      };
    }

    return albums;
  } catch {
    return {};
  }
}

type WordRenderData = {
  headings: ReturnType<typeof extractHeadings>;
  albums: ReturnType<typeof resolveAlbumsFromWordContent>;
};

const cache = new Map<string, WordRenderData>();

function getWordRenderData(slug: string, updatedAt: string, markdown: string): WordRenderData {
  const key = `${slug}:${updatedAt}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const value = {
    headings: extractHeadings(markdown),
    albums: resolveAlbumsFromWordContent(markdown),
  };
  cache.set(key, value);
  return value;
}

export { getWordRenderData };
