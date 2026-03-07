import { beforeEach, describe, expect, it, vi } from "vitest";

const { headObject } = vi.hoisted(() => ({
  headObject: vi.fn(),
}));

vi.mock("@/lib/platform/r2", () => ({
  headObject,
  downloadBuffer: vi.fn(),
  uploadBuffer: vi.fn(),
}));

import { inferCompatibleTransferFileState } from "@/features/media/backends/local";
import type { TransferFile } from "@/features/transfers/store";

describe("transfer compatibility inference", () => {
  beforeEach(() => {
    headObject.mockReset();
  });

  it("marks legacy visual media ready when derived assets exist", async () => {
    headObject
      .mockResolvedValueOnce({ exists: true })
      .mockResolvedValueOnce({ exists: true });

    const file: TransferFile = {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 1234,
      mimeType: "image/jpeg",
      storageKey: "transfers/abc123/originals/photo.jpg",
    };

    const inferred = await inferCompatibleTransferFileState("abc123", file);

    expect(inferred.previewStatus).toBe("ready");
    expect(inferred.processingStatus).toBe("local_done");
    expect(inferred.processingRoute).toBe("local_image");
  });

  it("marks legacy visual media failed when derived assets are missing", async () => {
    headObject
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false });

    const file: TransferFile = {
      id: "capture",
      filename: "capture.dng",
      kind: "image",
      size: 4567,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/abc123/originals/capture.dng",
    };

    const inferred = await inferCompatibleTransferFileState("abc123", file);

    expect(inferred.previewStatus).toBe("original_only");
    expect(inferred.processingStatus).toBe("failed");
    expect(inferred.processingRoute).toBe("raw_try_local");
  });

  it("marks legacy non-visual media skipped", async () => {
    const file: TransferFile = {
      id: "notes.pdf",
      filename: "notes.pdf",
      kind: "file",
      size: 987,
      mimeType: "application/pdf",
      storageKey: "transfers/abc123/originals/notes.pdf",
    };

    const inferred = await inferCompatibleTransferFileState("abc123", file);

    expect(inferred.previewStatus).toBe("original_only");
    expect(inferred.processingStatus).toBe("skipped");
  });
});
