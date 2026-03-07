import { describe, expect, it } from "vitest";
import {
  buildTransferProcessingCounts,
  canRetryTransferProcessing,
  classifyTransferProcessingRoute,
  getTransferFileId,
  isTransferProcessingStale,
} from "@/features/transfers/media-state";

describe("transfer media state helpers", () => {
  it("derives transfer file ids from visual stems", () => {
    expect(getTransferFileId("photo.jpg")).toBe("photo");
    expect(getTransferFileId("clip.mp4")).toBe("clip");
    expect(getTransferFileId("capture.arw")).toBe("capture");
    expect(getTransferFileId("notes.pdf")).toBe("notes.pdf");
  });

  it("classifies processing routes by filename", () => {
    expect(classifyTransferProcessingRoute("photo.jpg")).toBe("local_image");
    expect(classifyTransferProcessingRoute("loop.gif")).toBe("local_gif");
    expect(classifyTransferProcessingRoute("clip.mov")).toBe("local_video");
    expect(classifyTransferProcessingRoute("capture.dng")).toBe("raw_try_local");
    expect(classifyTransferProcessingRoute("capture.hif")).toBeNull();
    expect(classifyTransferProcessingRoute("notes.pdf")).toBeNull();
  });

  it("counts ready, queued, failed, skipped, and original-only files", () => {
    const counts = buildTransferProcessingCounts([
      { previewStatus: "ready", processingStatus: "local_done" },
      { previewStatus: "original_only", processingStatus: "queued" },
      { previewStatus: "original_only", processingStatus: "processing" },
      { previewStatus: "original_only", processingStatus: "failed" },
      { previewStatus: "original_only", processingStatus: "skipped" },
    ]);

    expect(counts).toEqual({
      readyCount: 1,
      queuedCount: 2,
      failedCount: 1,
      skippedCount: 1,
      originalOnlyCount: 4,
    });
  });

  it("enforces retry cap and stale thresholds", () => {
    const staleQueued = {
      processingStatus: "queued" as const,
      enqueuedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      retryCount: 1,
    };
    const freshQueued = {
      processingStatus: "queued" as const,
      enqueuedAt: new Date().toISOString(),
      retryCount: 3,
    };

    expect(isTransferProcessingStale(staleQueued)).toBe(true);
    expect(canRetryTransferProcessing(staleQueued)).toBe(true);
    expect(isTransferProcessingStale(freshQueued)).toBe(false);
    expect(canRetryTransferProcessing(freshQueued)).toBe(false);
  });
});
