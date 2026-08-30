import type { FocalPreset } from "./focal";
import type { ResponsiveImageMetadata } from "./image";

const SAFE_ALBUM_PHOTO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeAlbumPhotoId(value: string): boolean {
  return value.length <= 120 && !value.includes("..") && SAFE_ALBUM_PHOTO_ID.test(value);
}

export function isValidAlbumDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export interface Photo extends ResponsiveImageMetadata {
  id: string;
  title?: string;
  alt?: string;
  caption?: string;
  size?: number;
  takenAt?: string;
  focalPoint?: FocalPreset;
  autoFocal?: { x: number; y: number };
}

export interface Album {
  slug: string;
  title: string;
  date: string;
  description?: string;
  cover: string;
  photos: Photo[];
  status?: "draft" | "published";
  updatedAt?: string;
}

export type { FocalPreset } from "./focal";
