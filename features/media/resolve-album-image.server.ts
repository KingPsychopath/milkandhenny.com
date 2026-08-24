import { MEDIA_PUBLIC_URL } from "@/lib/shared/config";
import { getAlbumBySlug } from "./albums.server";
import type { ResponsiveImageData } from "./image";
import { getAlbumImageData } from "./storage";

const CANONICAL_ALBUM_IMAGE = /^\/albums\/([^/]+)\/images\/([^/]+)\/\d+\.(?:avif|webp)$/;

function canonicalAlbumRef(src: string): { albumSlug: string; photoId: string } | null {
  try {
    const mediaBase = new URL(MEDIA_PUBLIC_URL);
    const candidate = new URL(src, mediaBase);
    if (candidate.origin !== mediaBase.origin) return null;

    const basePath = mediaBase.pathname.replace(/\/$/, "");
    const relativePath = candidate.pathname.slice(basePath.length) || "/";
    const match = relativePath.match(CANONICAL_ALBUM_IMAGE);
    if (!match) return null;

    return {
      albumSlug: decodeURIComponent(match[1]),
      photoId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function resolveAlbumImageUrls(
  sources: readonly string[],
): Promise<Record<string, ResponsiveImageData>> {
  const resolved: Record<string, ResponsiveImageData> = {};
  const albums = new Map<string, Awaited<ReturnType<typeof getAlbumBySlug>>>();

  for (const source of new Set(sources)) {
    const ref = canonicalAlbumRef(source);
    if (!ref) continue;

    let album = albums.get(ref.albumSlug);
    if (album === undefined) {
      album = await getAlbumBySlug(ref.albumSlug);
      albums.set(ref.albumSlug, album);
    }
    const photo = album?.photos.find((candidate) => candidate.id === ref.photoId);
    if (photo) resolved[source] = getAlbumImageData(ref.albumSlug, photo);
  }

  return resolved;
}

export { resolveAlbumImageUrls };
