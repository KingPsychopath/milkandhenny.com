import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("words raw upload handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("queues non-raw image uploads instead of processing them inline", async () => {
    const enqueueWordMediaJob = vi.fn().mockResolvedValue(undefined);
    const downloadBuffer = vi.fn();
    const uploadBuffer = vi.fn();
    const deleteObject = vi.fn();

    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      deleteObject,
      downloadBuffer,
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/words/media-queue", () => ({
      enqueueWordMediaJob,
    }));

    const { POST } = await import("@/app/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Hero.JPG",
            filename: "hero.webp",
            uploadKey: "words/media/launch-notes/incoming/tmp-hero.jpg",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: [
        {
          filename: "hero.webp",
          kind: "image",
          markdown: "![hero](words/media/launch-notes/hero.webp)",
        },
      ],
      queuedCount: 1,
    });
    expect(enqueueWordMediaJob).toHaveBeenCalledWith(
      expect.objectContaining({
        original: "Hero.JPG",
        uploadKey: "words/media/launch-notes/incoming/tmp-hero.jpg",
        finalFilename: "hero.webp",
      })
    );
    expect(downloadBuffer).not.toHaveBeenCalled();
    expect(uploadBuffer).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("returns webp output when raw preview extraction succeeds", async () => {
    const downloadBuffer = vi.fn().mockResolvedValue(Buffer.from("raw"));
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      deleteObject,
      downloadBuffer,
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processToWebP: vi.fn().mockResolvedValue({
          buffer: Buffer.from("webp"),
          width: 1600,
          height: 1067,
          takenAt: null,
        }),
      };
    });

    const { POST } = await import("@/app/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Capture.DNG",
            filename: "capture.dng",
            uploadKey: "words/media/launch-notes/incoming/tmp-capture.dng",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: [
        {
          filename: "capture.webp",
          kind: "image",
          markdown: "![capture](words/media/launch-notes/capture.webp)",
        },
      ],
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      "words/media/launch-notes/capture.webp",
      Buffer.from("webp"),
      "image/webp"
    );
    expect(deleteObject).toHaveBeenCalledWith("words/media/launch-notes/incoming/tmp-capture.dng");
  });

  it("stores the original raw and returns link markdown when no preview is usable", async () => {
    const downloadBuffer = vi.fn().mockResolvedValue(Buffer.from("raw"));
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      deleteObject,
      downloadBuffer,
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/media/processing", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing")>(
        "@/features/media/processing"
      );
      return {
        ...actual,
        processToWebP: vi
          .fn()
          .mockRejectedValue(new actual.RawPreviewUnavailableError(".dng", "missing")),
      };
    });

    const { POST } = await import("@/app/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Capture.DNG",
            filename: "capture.dng",
            uploadKey: "words/media/launch-notes/incoming/tmp-capture.dng",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      uploaded: [
        {
          filename: "capture.dng",
          kind: "file",
          markdown: "[capture](words/media/launch-notes/capture.dng)",
        },
      ],
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      "words/media/launch-notes/capture.dng",
      Buffer.from("raw"),
      "image/x-adobe-dng"
    );
    expect(deleteObject).toHaveBeenCalledWith("words/media/launch-notes/incoming/tmp-capture.dng");
  });

  it("treats raw uploads as colliding with existing webp names during presign", async () => {
    vi.doMock("@/features/auth/server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2", () => ({
      isConfigured: () => true,
      listObjects: vi.fn().mockResolvedValue([{ key: "words/media/launch-notes/capture.webp" }]),
      presignPutUrl: vi.fn(),
    }));

    const { POST } = await import("@/app/api/upload/words/presign/route");
    const response = await POST(
      makeRequest("/api/upload/words/presign", {
        slug: "launch-notes",
        files: [{ name: "Capture.DNG", size: 42, type: "image/x-adobe-dng" }],
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      skipped: ["capture.dng"],
      urls: [],
    });
  });
});
