import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("words raw upload handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/features/words/media-storage.server", () => ({
      getWordMediaStorageScope: vi.fn().mockResolvedValue("public"),
    }));
    vi.doMock("@/features/words/image.server", () => ({
      mergeWordImageMetadata: vi.fn().mockResolvedValue(undefined),
      pruneWordImageVariants: vi.fn().mockResolvedValue(0),
    }));
  });

  it("processes non-raw image uploads inline", async () => {
    const downloadBuffer = vi.fn().mockResolvedValue(Buffer.from("jpg"));
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObject,
      downloadBuffer,
      headObject: vi.fn().mockResolvedValue({ exists: true, size: 42, contentType: "image/jpeg" }),
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      return {
        ...actual,
        processResponsiveImage: vi.fn().mockResolvedValue({
          variants: [
            {
              width: 1600,
              formats: {
                avif: { buffer: Buffer.from("avif"), contentType: "image/avif", ext: ".avif" },
                webp: { buffer: Buffer.from("webp"), contentType: "image/webp", ext: ".webp" },
              },
            },
          ],
          width: 1600,
          height: 1067,
          version: "test-version",
          placeholder: { color: "#123456", blurDataUrl: "data:image/jpeg;base64,test" },
          takenAt: null,
        }),
      };
    });

    const { POST } = await import("@/src/routes/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Hero.JPG",
            filename: "hero.webp",
            uploadKey: "incoming/words/media/launch-notes/tmp-hero.jpg",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      }),
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
      queuedCount: 0,
    });
    expect(downloadBuffer).toHaveBeenCalledWith("incoming/words/media/launch-notes/tmp-hero.jpg", {
      scope: "private",
    });
    expect(uploadBuffer).toHaveBeenCalledWith(
      "words/media/launch-notes/hero.webp",
      Buffer.from("webp"),
      "image/webp",
      {
        cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
        scope: "public",
      },
    );
    expect(deleteObject).toHaveBeenCalledWith("incoming/words/media/launch-notes/tmp-hero.jpg", {
      scope: "private",
    });
  });

  it("returns webp output when raw preview extraction succeeds", async () => {
    const downloadBuffer = vi.fn().mockResolvedValue(Buffer.from("raw"));
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObject,
      downloadBuffer,
      headObject: vi
        .fn()
        .mockResolvedValue({ exists: true, size: 42, contentType: "image/x-adobe-dng" }),
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      return {
        ...actual,
        processResponsiveImage: vi.fn().mockResolvedValue({
          variants: [
            {
              width: 1600,
              formats: {
                avif: { buffer: Buffer.from("avif"), contentType: "image/avif", ext: ".avif" },
                webp: { buffer: Buffer.from("webp"), contentType: "image/webp", ext: ".webp" },
              },
            },
          ],
          width: 1600,
          height: 1067,
          version: "test-version",
          placeholder: { color: "#123456", blurDataUrl: "data:image/jpeg;base64,test" },
          takenAt: null,
        }),
      };
    });

    const { POST } = await import("@/src/routes/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Capture.DNG",
            filename: "capture.dng",
            uploadKey: "incoming/words/media/launch-notes/tmp-capture.dng",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      }),
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
      "image/webp",
      { cacheControl: "public, max-age=3600, stale-while-revalidate=86400", scope: "public" },
    );
    expect(deleteObject).toHaveBeenCalledWith("incoming/words/media/launch-notes/tmp-capture.dng", {
      scope: "private",
    });
  });

  it("stores the original raw and returns link markdown when no preview is usable", async () => {
    const downloadBuffer = vi.fn().mockResolvedValue(Buffer.from("raw"));
    const uploadBuffer = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      deleteObject,
      downloadBuffer,
      headObject: vi
        .fn()
        .mockResolvedValue({ exists: true, size: 42, contentType: "image/x-adobe-dng" }),
      isConfigured: () => true,
      uploadBuffer,
    }));
    vi.doMock("@/features/media/processing.server", async () => {
      const actual = await vi.importActual<typeof import("@/features/media/processing.server")>(
        "@/features/media/processing.server",
      );
      return {
        ...actual,
        processResponsiveImage: vi
          .fn()
          .mockRejectedValue(new actual.RawPreviewUnavailableError(".dng", "missing")),
      };
    });

    const { POST } = await import("@/src/routes/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Capture.DNG",
            filename: "capture.dng",
            uploadKey: "incoming/words/media/launch-notes/tmp-capture.dng",
            kind: "image",
            size: 42,
            overwrote: false,
          },
        ],
      }),
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
      "image/x-adobe-dng",
      {
        cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
        contentDisposition: "attachment; filename=\"capture.dng\"; filename*=UTF-8''capture.dng",
        scope: "public",
      },
    );
    expect(deleteObject).toHaveBeenCalledWith("incoming/words/media/launch-notes/tmp-capture.dng", {
      scope: "private",
    });
  });

  it("promotes non-image uploads from lifecycle-managed staging", async () => {
    const copyObject = vi.fn().mockResolvedValue(undefined);
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      copyObject,
      deleteObject,
      headObject: vi.fn().mockResolvedValue({
        exists: true,
        size: 42,
        contentType: "application/pdf",
      }),
      isConfigured: () => true,
    }));

    const { POST } = await import("@/src/routes/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Programme.pdf",
            filename: "programme.pdf",
            uploadKey: "incoming/words/media/launch-notes/tmp-programme.pdf",
            kind: "file",
            size: 42,
            overwrote: false,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(copyObject).toHaveBeenCalledWith(
      "incoming/words/media/launch-notes/tmp-programme.pdf",
      "words/media/launch-notes/programme.pdf",
      {
        sourceScope: "private",
        destinationScope: "public",
        contentType: "application/pdf",
        cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
        contentDisposition:
          "attachment; filename=\"programme.pdf\"; filename*=UTF-8''programme.pdf",
      },
    );
    expect(deleteObject).toHaveBeenCalledWith(
      "incoming/words/media/launch-notes/tmp-programme.pdf",
      { scope: "private" },
    );
  });

  it("rejects a final destination that does not match the reserved filename", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
    }));

    const { POST } = await import("@/src/routes/api/upload/words/finalize/route");
    const response = await POST(
      makeRequest("/api/upload/words/finalize", {
        slug: "launch-notes",
        files: [
          {
            original: "Programme.pdf",
            filename: "different.pdf",
            uploadKey: "incoming/words/media/launch-notes/tmp-programme.pdf",
            kind: "file",
            size: 42,
            overwrote: false,
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Destination filename did not match: Programme.pdf",
    });
  });

  it("treats raw uploads as colliding with existing webp names during presign", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({ error: null }),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      isConfigured: () => true,
      listObjects: vi.fn().mockResolvedValue([{ key: "words/media/launch-notes/capture.webp" }]),
      presignPutUrl: vi.fn(),
    }));

    const { POST } = await import("@/src/routes/api/upload/words/presign/route");
    const response = await POST(
      makeRequest("/api/upload/words/presign", {
        slug: "launch-notes",
        files: [{ name: "Capture.DNG", size: 42, type: "image/x-adobe-dng" }],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      skipped: ["capture.dng"],
      urls: [],
    });
  });
});
