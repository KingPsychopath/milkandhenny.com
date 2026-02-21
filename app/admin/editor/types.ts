export type NoteVisibility = "public" | "unlisted" | "private";
export type WordType = "blog" | "note" | "recipe" | "review";
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
