import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(url: string) {
  return new NextRequest(`http://localhost${url}`);
}

describe("download presign", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should presign album originals as attachment downloads", async () => {
    const presignGetUrl = vi.fn().mockResolvedValue("https://example.com/download");
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignGetUrl,
    }));

    const { GET } = await import("@/app/api/download/presign/route");
    const response = await GET(
      makeRequest("/api/download/presign?key=albums/rekki/original/DSC08357.jpg&filename=DSC08357.jpg")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://example.com/download" });
    expect(presignGetUrl).toHaveBeenCalledWith("albums/rekki/original/DSC08357.jpg", {
      responseContentDisposition:
        'attachment; filename="DSC08357.jpg"; filename*=UTF-8\'\'DSC08357.jpg',
      responseContentType: "application/octet-stream",
      expiresIn: 300,
    });
  });

  it("should reject keys outside the allowed public download scope", async () => {
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignGetUrl: vi.fn(),
    }));

    const { GET } = await import("@/app/api/download/presign/route");
    const response = await GET(makeRequest("/api/download/presign?key=words/media/post/hero.webp"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid download key." });
  });

  it("should derive the filename from a valid transfer key when omitted", async () => {
    const presignGetUrl = vi.fn().mockResolvedValue("https://example.com/download");
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignGetUrl,
    }));

    const { GET } = await import("@/app/api/download/presign/route");
    const response = await GET(
      makeRequest("/api/download/presign?key=transfers/velvet-moon-candle/originals/IMG_1234.HEIC")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: "https://example.com/download" });
    expect(presignGetUrl).toHaveBeenCalledWith("transfers/velvet-moon-candle/originals/IMG_1234.HEIC", {
      responseContentDisposition:
        'attachment; filename="IMG_1234.HEIC"; filename*=UTF-8\'\'IMG_1234.HEIC',
      responseContentType: "application/octet-stream",
      expiresIn: 300,
    });
  });
});
