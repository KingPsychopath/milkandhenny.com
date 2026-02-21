"use client";

import { useCallback, useState } from "react";
import type { WordMediaItem } from "../types";

export function useMediaPreviewState() {
  const [previewItems, setPreviewItems] = useState<WordMediaItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const closePreview = useCallback(() => {
    setPreviewIndex(null);
    setPreviewItems([]);
  }, []);

  const openPreview = useCallback((items: WordMediaItem[], key: string) => {
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    setPreviewItems(items);
    setPreviewIndex(index);
  }, []);

  const hasPreview = previewIndex !== null && !!previewItems[previewIndex];

  return {
    previewItems,
    previewIndex,
    setPreviewIndex,
    closePreview,
    openPreview,
    hasPreview,
  };
}

