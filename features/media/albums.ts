import type { FocalPreset } from "./focal";
import type { ResponsiveImageMetadata } from "./image";

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
