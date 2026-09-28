export type MediaKind = "image" | "video" | "gif" | "audio" | "file";

export interface MediaPreviewItem {
  key: string;
  filename: string;
  kind: MediaKind;
  url: string;
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
