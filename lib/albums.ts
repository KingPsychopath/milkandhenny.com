import fs from "fs";
import path from "path";

const ALBUMS_DIR = path.join(process.cwd(), "content/albums");

import type { FocalPreset } from "./focal";

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

export { getAlbumBySlug, getAllAlbums, getAllAlbumSlugs };
export type { Album, Photo };
