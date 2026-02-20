export type NoteVisibility = "public" | "unlisted" | "private";

export interface NoteMeta {
  slug: string;
  title: string;
  subtitle?: string;
  visibility: NoteVisibility;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  tags?: string[];
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

export interface NoteRecord {
  meta: NoteMeta;
  markdown: string;
}
