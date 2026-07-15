export type { WordType } from "@/features/words/types";
import type { WordType } from "@/features/words/types";
import type { WordVisibility } from "@/features/words/content-types";

export type NoteVisibility = WordVisibility;
export type MediaKind = "image" | "video" | "gif" | "audio" | "file";

export interface MediaPreviewItem {
  key: string;
  filename: string;
  kind: MediaKind;
  url: string;
}

export interface NoteMeta {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type: WordType;
  visibility: NoteVisibility;
  tags: string[];
  readingTime?: number;
  featured?: boolean;
  updatedAt: string;
}

export interface NoteRecord {
  meta: NoteMeta;
  markdown: string;
}

export interface ShareLink {
  id: string;
  slug: string;
  expiresAt: string;
  pinRequired: boolean;
  revokedAt?: string;
  updatedAt: string;
}

export interface SharePatchResponse {
  link?: ShareLink;
  token?: string;
  error?: string;
}

export type ShareStateFilter = "all" | "active" | "expired" | "revoked";

export interface SharedWordSummary {
  slug: string;
  activeShareCount: number;
}

export interface WordMediaItem extends MediaPreviewItem {
  size: number;
  lastModified?: string;
  markdown: string;
  assetId?: string;
}

export interface WordMediaResponse {
  slug: string;
  assetsIncluded?: boolean;
  pageMedia?: WordMediaItem[];
  assets?: WordMediaItem[];
  error?: string;
}
