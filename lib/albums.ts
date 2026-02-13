import fs from "fs";
import path from "path";

const ALBUMS_DIR = path.join(process.cwd(), "content/albums");

import type { FocalPreset } from "./focal";
import { isValidFocalPreset } from "./focal";

export type { FocalPreset } from "./focal";

/** A single photo in an album */
type Photo = {
  id: string;
  width: number;
  height: number;
  /** Optional tiny base64 blur placeholder */
  blur?: string;
  /** ISO date from EXIF DateTimeOriginal (when the photo was taken) */
  takenAt?: string;
  /** Manual crop focal point override (preset name). Takes priority over autoFocal. */
  focalPoint?: FocalPreset;
  /** Auto-detected face center as { x, y } percentages. Used when no manual focalPoint. */
  autoFocal?: { x: number; y: number };
};

/** Album metadata from JSON */
type Album = {
  slug: string;
  title: string;
  date: string;
  description?: string;
  /** Photo ID used as the cover image */
  cover: string;
  photos: Photo[];
};

/** Read a single album by slug */
function getAlbumBySlug(slug: string): Album | null {
  const filePath = path.join(ALBUMS_DIR, `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  return { slug, ...data };
}

/** Get all albums sorted by date (newest first) */
function getAllAlbums(): Album[] {
  if (!fs.existsSync(ALBUMS_DIR)) return [];

  const files = fs.readdirSync(ALBUMS_DIR).filter((f) => f.endsWith(".json"));

  const albums = files
    .map((file) => {
      const slug = file.replace(/\.json$/, "");
      return getAlbumBySlug(slug);
    })
    .filter((a): a is Album => a !== null);

  return albums.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

/** Get all album slugs for static generation */
function getAllAlbumSlugs(): string[] {
  if (!fs.existsSync(ALBUMS_DIR)) return [];

  return fs
    .readdirSync(ALBUMS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
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
function validateAllAlbums(): { slug: string; errors: string[] }[] {
  const slugs = getAllAlbumSlugs();
  const results: { slug: string; errors: string[] }[] = [];

  for (const slug of slugs) {
    const album = getAlbumBySlug(slug);
    if (!album) {
      results.push({ slug, errors: ["Failed to load album"] });
      continue;
    }
    const errors = validateAlbum(album);
    if (errors.length > 0) {
      results.push({ slug, errors });
    }
  }

  return results;
}

export { getAlbumBySlug, getAllAlbums, getAllAlbumSlugs, validateAlbum, validateAllAlbums };
export type { Album, Photo };
