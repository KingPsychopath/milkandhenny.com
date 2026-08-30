import type { WordType } from "@/features/words/types";

export const WORD_VISIBILITIES = ["public", "unlisted", "private"] as const;
export type WordVisibility = (typeof WORD_VISIBILITIES)[number];
export type NoteVisibility = WordVisibility;

export function isWordVisibility(value: unknown): value is WordVisibility {
  return typeof value === "string" && WORD_VISIBILITIES.includes(value as WordVisibility);
}

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

export type ShareLinkView = Omit<
  ShareLink,
  "tokenHash" | "pinHash" | "pinUpdatedAt" | "createdByRole"
>;

export interface WordRecord {
  meta: WordMeta;
  markdown: string;
}

// Backward-compatible type aliases for internal gradual rename.
export type NoteMeta = WordMeta;
export type NoteRecord = WordRecord;
