import type { FocalPreset } from "./focal";

export interface Photo {
  id: string;
  width: number;
  height: number;
  size?: number;
  blur?: string;
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
