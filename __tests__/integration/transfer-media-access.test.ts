import { beforeEach, describe, expect, it, vi } from "vitest";
import { transferContainsStorageKey } from "@/features/transfers/media-access";
import type { TransferData } from "@/features/transfers/types";

const transfer = {
  id: "private-transfer",
  title: "private",
  createdAt: "2026-07-15T00:00:00.000Z",
  expiresAt: "2999-07-16T00:00:00.000Z",
  deleteToken: "delete-secret",
  files: [
    {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 10,
      mimeType: "image/jpeg",
      storageKey: "transfers/private-transfer/originals/photo.jpg",
      previewStatus: "ready",
    },
  ],
};

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`);
}

describe("protected transfer media", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should redirect an existing transfer file to a private URL that outlasts playback", async () => {
    const presignGetUrl = vi.fn().mockResolvedValue("https://private.example/signed");
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue(transfer),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));

    const { GET } = await import("@/src/routes/api/transfers/$id/media/$fileId/$variant/route");
    const response = await GET(
      makeRequest("/api/transfers/private-transfer/media/photo/original?download=1"),
      {
        params: Promise.resolve({
          id: "private-transfer",
          fileId: "photo",
          variant: "original",
        }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://private.example/signed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // Originals are streamed: a `<video>` re-requests byte ranges when the
    // viewer seeks, so the signature has to outlive a long watch.
    expect(presignGetUrl).toHaveBeenCalledWith(
      "transfers/private-transfer/originals/photo.jpg",
      expect.objectContaining({ expiresIn: 3600 }),
    );
  });

  it("should not sign a file that is absent from the transfer", async () => {
    const presignGetUrl = vi.fn();
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue(transfer),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));

    const { GET } = await import("@/src/routes/api/transfers/$id/media/$fileId/$variant/route");
    const response = await GET(
      makeRequest("/api/transfers/private-transfer/media/not-a-file/original"),
      {
        params: Promise.resolve({
          id: "private-transfer",
          fileId: "not-a-file",
          variant: "original",
        }),
      },
    );

    expect(response.status).toBe(404);
    expect(presignGetUrl).not.toHaveBeenCalled();
  });

  it("signs only the currently published derivative generation", async () => {
    const claimToken = "00000000-0000-0000-0000-000000000123";
    const generated: TransferData = {
      ...transfer,
      files: [
        {
          ...transfer.files[0],
          kind: "image",
          previewStatus: "ready",
          derivativeGeneration: 2,
          derivativeClaimToken: claimToken,
        },
      ],
    };
    const presignGetUrl = vi.fn().mockResolvedValue("https://private.example/generated");
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue(generated),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));
    const { GET } = await import("@/src/routes/api/transfers/$id/media/$fileId/$variant/route");
    const response = await GET(makeRequest("/api/transfers/private-transfer/media/photo/thumb"), {
      params: Promise.resolve({ id: "private-transfer", fileId: "photo", variant: "thumb" }),
    });
    expect(response.status).toBe(307);
    expect(presignGetUrl).toHaveBeenCalledWith(
      `transfers/private-transfer/thumb/photo/g2/${claimToken}.webp`,
      expect.any(Object),
    );
    expect(
      transferContainsStorageKey(generated, "transfers/private-transfer/thumb/photo.webp"),
    ).toBe(false);
    expect(
      transferContainsStorageKey(
        generated,
        `transfers/private-transfer/thumb/photo/g2/${claimToken}.webp`,
      ),
    ).toBe(true);
  });
});
