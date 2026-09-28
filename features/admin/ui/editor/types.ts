export type { WordType } from "@/features/words/types";
import type { WordType } from "@/features/words/types";
import type { WordVisibility } from "@/features/words/content-types";

export type NoteVisibility = WordVisibility;
export type {
  MediaKind,
  MediaPreviewItem,
  WordMediaItem,
  WordMediaResponse,
} from "@/features/words/admin-media-library.types";

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
