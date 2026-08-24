import { isValidFocalPreset } from "./focal";
import type { Album } from "./albums";
import { isSafeAlbumSlug, listAlbumManifests, readAlbumManifest } from "./album-repository.server";

/** Read a single album by slug */
async function getAlbumBySlug(slug: string): Promise<Album | null> {
  if (!isSafeAlbumSlug(slug)) return null;
  const album = await readAlbumManifest(slug);
  return album && album.status !== "draft" && album.photos.length > 0 ? album : null;
}

/** Get all albums sorted by date (newest first) */
async function getAllAlbums(): Promise<Album[]> {
  const albums = (await listAlbumManifests()).filter(
    (album) => album.status !== "draft" && album.photos.length > 0,
  );
  return albums.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Get all album slugs for static generation */
async function getAllAlbumSlugs(): Promise<string[]> {
  return (await getAllAlbums()).map((album) => album.slug);
}

/** Validation: focal presets and autoFocal ranges. Returns list of error messages. */
function validateAlbum(album: Album): string[] {
  const errors: string[] = [];

  if (!album.title || typeof album.title !== "string") {
    errors.push("Missing or invalid title");
  }
  if (!album.date || typeof album.date !== "string") {
    errors.push("Missing or invalid date");
  }
  if (!album.cover || typeof album.cover !== "string") {
    errors.push("Missing or invalid cover");
  }
  if (!Array.isArray(album.photos)) {
    errors.push("photos must be an array");
    return errors;
  }

  album.photos.forEach((photo, i) => {
    const prefix = `photo[${i}] (${photo?.id ?? "?"})`;
    if (!photo || typeof photo.id !== "string") {
      errors.push(`${prefix}: missing id`);
      return;
    }
    if (typeof photo.width !== "number" || typeof photo.height !== "number") {
      errors.push(`${prefix}: width and height must be numbers`);
    }
    if (typeof photo.version !== "string" || !photo.version) {
      errors.push(`${prefix}: version is required`);
    }
    if (!Array.isArray(photo.widths) || photo.widths.length === 0) {
      errors.push(`${prefix}: responsive widths are required`);
    }
    if (!photo.placeholder || typeof photo.placeholder.color !== "string") {
      errors.push(`${prefix}: placeholder colour is required`);
    }
    if (photo.size !== undefined && typeof photo.size !== "number") {
      errors.push(`${prefix}: size must be a number when provided`);
    }
    if (photo.focalPoint !== undefined) {
      if (typeof photo.focalPoint !== "string" || !isValidFocalPreset(photo.focalPoint)) {
        errors.push(`${prefix}: focalPoint must be a valid preset (e.g. center, top, mid left)`);
      }
    }
    if (photo.autoFocal !== undefined) {
      const af = photo.autoFocal;
      if (
        typeof af !== "object" ||
        af === null ||
        typeof (af as { x?: unknown }).x !== "number" ||
        typeof (af as { y?: unknown }).y !== "number"
      ) {
        errors.push(`${prefix}: autoFocal must be { x: number, y: number }`);
      } else {
        const { x, y } = af as { x: number; y: number };
        if (x < 0 || x > 100 || y < 0 || y > 100) {
          errors.push(`${prefix}: autoFocal x and y must be 0–100`);
        }
      }
    }
  });

  if (album.cover && Array.isArray(album.photos)) {
    const hasCover = album.photos.some((p) => p?.id === album.cover);
    if (!hasCover) {
      errors.push(`cover "${album.cover}" is not in photos`);
    }
  }

  return errors;
}

/** Run validation on all albums. Returns per-slug errors for CI. */
async function validateAllAlbums(): Promise<{ slug: string; errors: string[] }[]> {
  const albums = await getAllAlbums();
  const results: { slug: string; errors: string[] }[] = [];

  for (const album of albums) {
    const errors = validateAlbum(album);
    if (errors.length > 0) {
      results.push({ slug: album.slug, errors });
    }
  }

  return results;
}

export { getAlbumBySlug, getAllAlbums, getAllAlbumSlugs, validateAlbum, validateAllAlbums };
