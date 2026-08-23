import type { FocalPreset } from "./focal";
import type { ResponsiveImageMetadata } from "./image";

export interface Photo extends ResponsiveImageMetadata {
  id: string;
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
}

export type { FocalPreset } from "./focal";
