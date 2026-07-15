import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(url: string) {
  return new Request(`http://localhost${url}`);
}

describe("download presign", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should presign album originals as attachment downloads", async () => {
    const presignGetUrl = vi.fn().mockResolvedValue("https://example.com/download");
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));

    const { GET } = await import("@/src/routes/api/download/presign/route");
    const response = await GET(
      makeRequest(
        "/api/download/presign?key=albums/rekki/original/DSC08357.jpg&filename=DSC08357.jpg",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://example.com/download" });
    expect(presignGetUrl).toHaveBeenCalledWith("albums/rekki/original/DSC08357.jpg", {
      responseContentDisposition:
        "attachment; filename=\"DSC08357.jpg\"; filename*=UTF-8''DSC08357.jpg",
      responseContentType: "application/octet-stream",
      expiresIn: 3600,
    });
  });

  it("should reject keys outside the allowed public download scope", async () => {
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      isTransferStorageConfigured: () => true,
      presignGetUrl: vi.fn(),
    }));

    const { GET } = await import("@/src/routes/api/download/presign/route");
    const response = await GET(makeRequest("/api/download/presign?key=words/media/post/hero.webp"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid download key." });
  });

  it("should derive the filename from a valid transfer key when omitted", async () => {
    const presignGetUrl = vi.fn().mockResolvedValue("https://example.com/download");
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "velvet-moon-candle",
        expiresAt: "2999-01-01T00:00:00.000Z",
        files: [
          {
            id: "photo",
            storageKey: "transfers/velvet-moon-candle/originals/IMG_1234.HEIC",
          },
        ],
      }),
    }));

    const { GET } = await import("@/src/routes/api/download/presign/route");
    const response = await GET(
      makeRequest("/api/download/presign?key=transfers/velvet-moon-candle/originals/IMG_1234.HEIC"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://example.com/download" });
    expect(presignGetUrl).toHaveBeenCalledWith(
      "transfers/velvet-moon-candle/originals/IMG_1234.HEIC",
      {
        responseContentDisposition:
          "attachment; filename=\"IMG_1234.HEIC\"; filename*=UTF-8''IMG_1234.HEIC",
        responseContentType: "application/octet-stream",
        expiresIn: 3600,
      },
    );
  });

  it("should reject a valid-looking transfer key that is not in that transfer", async () => {
    const presignGetUrl = vi.fn();
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      isTransferStorageConfigured: () => true,
      presignGetUrl,
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      getTransfer: vi.fn().mockResolvedValue({
        id: "private-transfer",
        expiresAt: "2999-01-01T00:00:00.000Z",
        files: [
          {
            id: "allowed",
            storageKey: "transfers/private-transfer/originals/allowed.jpg",
          },
        ],
      }),
    }));

    const { GET } = await import("@/src/routes/api/download/presign/route");
    const response = await GET(
      makeRequest("/api/download/presign?key=transfers/private-transfer/originals/secret.jpg"),
    );

    expect(response.status).toBe(404);
    expect(presignGetUrl).not.toHaveBeenCalled();
  });
});
