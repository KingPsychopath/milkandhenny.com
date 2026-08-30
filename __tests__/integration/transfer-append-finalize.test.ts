import { beforeEach, describe, expect, it, vi } from "vitest";

const request = new Request("http://localhost/api/drop/finalize", { method: "POST" });

function transfer() {
  return {
    id: "transfer-1",
    title: "party",
    files: [],
    createdAt: "2026-08-30T10:00:00.000Z",
    expiresAt: "2999-08-30T10:00:00.000Z",
    deleteToken: "delete-token",
  };
}

describe("transfer append finalization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/features/transfers/store.server", () => ({
      MAX_TRANSFER_FILES: 500,
      getTransfer: vi.fn().mockResolvedValue(transfer()),
      appendTransferFiles: vi.fn(),
      updateTransferGrouping: vi.fn(),
    }));
    vi.doMock("@/features/transfers/upload.server", () => ({
      applyTransferAssetGroups: (files: unknown[]) => ({ files }),
      isSafeTransferFilename: () => true,
      processUploadedFile: vi.fn(),
      sortTransferFiles: (files: unknown[]) => files,
    }));
    vi.doMock("@/features/transfers/media-state", () => ({
      HEIF_TRANSFER_UPLOAD_ERROR: "HEIF is unsupported",
      buildTransferProcessingCounts: vi.fn(),
      isHeifUploadLike: () => false,
      resolveTransferUploadIds: (files: Array<{ name: string }>) =>
        files.map((file) => ({ ...file, mediaId: file.name })),
    }));
    vi.doMock("@/lib/platform/api-error", () => ({
      apiErrorFromRequest: vi.fn(),
    }));
    vi.doMock("@/lib/shared/config", () => ({
      getBaseUrlForRequest: () => "http://localhost",
    }));
  });

  it("rejects malformed file entries before deriving media ids", async () => {
    vi.doMock("@/lib/platform/r2.server", () => ({
      isTransferStorageConfigured: () => true,
    }));
    const { appendFinalize } = await import("@/features/transfers/append.server");

    const response = await appendFinalize(request, "transfer-1", [{}]);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Each file must have a safe filename",
    });
  });

  it("does not publish metadata for an object that never reached private storage", async () => {
    const headObject = vi.fn().mockResolvedValue({ exists: false });
    vi.doMock("@/lib/platform/r2.server", () => ({
      headObject,
      isTransferStorageConfigured: () => true,
    }));
    const upload = await import("@/features/transfers/upload.server");
    const { appendFinalize } = await import("@/features/transfers/append.server");

    const response = await appendFinalize(request, "transfer-1", [
      { name: "programme.pdf", size: 42, type: "application/pdf" },
    ]);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Uploaded object size does not match the reservation for programme.pdf",
    });
    expect(upload.processUploadedFile).not.toHaveBeenCalled();
  });
});
