import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/upload/transfer/presign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("upload transfer presign", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://example.com";
  });

  it("should bypass transfer size caps for admins", async () => {
    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "admin" },
      }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignPutUrl: vi.fn().mockResolvedValue("https://example.com/upload"),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      generateTransferId: () => "transfer-id",
      generateDeleteToken: () => "delete-token",
      parseExpiry: () => 3600,
      DEFAULT_EXPIRY_SECONDS: 3600,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
    }));

    const { POST } = await import("@/app/api/upload/transfer/presign/route");
    const response = await POST(
      makeRequest({
        title: "huge upload",
        files: [{ name: "huge.mov", size: 2 * 1024 * 1024 * 1024, type: "video/quicktime" }],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transferId: "transfer-id",
      deleteToken: "delete-token",
      urls: [{ name: "huge.mov", primaryUrl: "https://example.com/upload" }],
    });
  });

  it("should keep transfer size caps for non-admin upload sessions", async () => {
    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload" },
      }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignPutUrl: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      generateTransferId: () => "transfer-id",
      generateDeleteToken: () => "delete-token",
      parseExpiry: () => 3600,
      DEFAULT_EXPIRY_SECONDS: 3600,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
    }));

    const { POST } = await import("@/app/api/upload/transfer/presign/route");
    const response = await POST(
      makeRequest({
        title: "too big",
        files: [{ name: "huge.mov", size: 251 * 1024 * 1024, type: "video/quicktime" }],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "File too large. Max 250MB per file.",
    });
  });

  it("should allow files with the same stem and assign unique media ids", async () => {
    const presignPutUrl = vi.fn().mockResolvedValue("https://example.com/upload");
    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload" },
      }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignPutUrl,
    }));
    vi.doMock("@/features/transfers/store", () => ({
      generateTransferId: () => "transfer-id",
      generateDeleteToken: () => "delete-token",
      parseExpiry: () => 3600,
      DEFAULT_EXPIRY_SECONDS: 3600,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
    }));

    const { POST } = await import("@/app/api/upload/transfer/presign/route");
    const response = await POST(
      makeRequest({
        title: "same stem files",
        files: [
          { name: "Screen Recording 2026-03-06 at 17.49.53.mov", size: 10, type: "video/quicktime" },
          { name: "Screen Recording 2026-03-06 at 17.49.53.mp4", size: 20, type: "video/mp4" },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      urls: [
        {
          name: "Screen Recording 2026-03-06 at 17.49.53.mov",
          mediaId: "Screen Recording 2026-03-06 at 17.49.53",
          primaryUrl: "https://example.com/upload",
        },
        {
          name: "Screen Recording 2026-03-06 at 17.49.53.mp4",
          mediaId: "Screen Recording 2026-03-06 at 17.49.53-2",
          primaryUrl: "https://example.com/upload",
        },
      ],
    });
  });

  it("should reject raw heif uploads", async () => {
    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload" },
      }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      presignPutUrl: vi.fn(),
    }));
    vi.doMock("@/features/transfers/store", () => ({
      generateTransferId: () => "transfer-id",
      generateDeleteToken: () => "delete-token",
      parseExpiry: () => 3600,
      DEFAULT_EXPIRY_SECONDS: 3600,
      MAX_EXPIRY_SECONDS: 30 * 24 * 60 * 60,
      MAX_TRANSFER_FILE_BYTES: 250 * 1024 * 1024,
      MAX_TRANSFER_TOTAL_BYTES: 1024 * 1024 * 1024,
    }));

    const { POST } = await import("@/app/api/upload/transfer/presign/route");
    const response = await POST(
      makeRequest({
        title: "raw heif",
        files: [{ name: "capture.hif", size: 10, type: "image/heif" }],
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "HEIC/HIF transfer uploads must be converted in the browser before upload.",
    });
  });
});
