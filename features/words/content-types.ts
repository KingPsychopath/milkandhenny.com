import type { WordType } from "@/features/words/types";

export type WordVisibility = "public" | "unlisted" | "private";
export type NoteVisibility = WordVisibility;

export interface WordMeta {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type: WordType;
  bodyKey: string;
  visibility: WordVisibility;
  createdAt: string;
  updatedAt: string;
  readingTime: number;
  readingTimeVersion: number;
  publishedAt?: string;
  tags: string[];
  featured?: boolean;
  authorRole: "admin";
}

export interface ShareLink {
  id: string;
  slug: string;
  tokenHash: string;
  expiresAt: string;
  pinRequired: boolean;
  pinHash?: string;
  pinUpdatedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdByRole: "admin";
}

export interface WordRecord {
  meta: WordMeta;
  markdown: string;
}

// Backward-compatible type aliases for internal gradual rename.
export type NoteMeta = WordMeta;
export type NoteRecord = WordRecord;
