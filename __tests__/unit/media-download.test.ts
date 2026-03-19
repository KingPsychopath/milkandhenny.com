import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("media download helpers", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads content-length from a HEAD response", async () => {
    const { fetchContentLength } = await import("@/lib/client/media-download");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "12345" } }))
    );

    await expect(fetchContentLength("https://example.com/file.jpg")).resolves.toBe(12345);
  });

  it("returns null when content-length is unavailable", async () => {
    const { fetchContentLength } = await import("@/lib/client/media-download");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    await expect(fetchContentLength("https://example.com/file.jpg")).resolves.toBeNull();
  });

  it("maps disk-full write errors to a user-facing message", async () => {
    const { getZipDownloadErrorMessage } = await import("@/lib/client/media-download");
    expect(
      getZipDownloadErrorMessage(
        new DOMException("The requested operation failed", "QuotaExceededError"),
        "fallback"
      )
    ).toBe("Download failed: not enough disk space.");
  });

  it("prefers worker zip fallback only for non-picker multi-file downloads when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_FILE_ZIP_URL", "https://example.workers.dev/zip");
    vi.stubEnv("NEXT_PUBLIC_MULTI_FILE_ZIP_MODE", "auto");
    const { shouldUseWorkerZipFallback } = await import("@/lib/client/media-download");

    expect(shouldUseWorkerZipFallback({ pickerAvailable: false, fileCount: 2 })).toBe(true);
    expect(shouldUseWorkerZipFallback({ pickerAvailable: true, fileCount: 2 })).toBe(false);
    expect(shouldUseWorkerZipFallback({ pickerAvailable: false, fileCount: 1 })).toBe(false);
  });

  it("can force the legacy client fallback off via env", async () => {
    vi.stubEnv("NEXT_PUBLIC_MULTI_FILE_ZIP_URL", "https://example.workers.dev/zip");
    vi.stubEnv("NEXT_PUBLIC_MULTI_FILE_ZIP_MODE", "client");
    const { shouldUseWorkerZipFallback } = await import("@/lib/client/media-download");

    expect(shouldUseWorkerZipFallback({ pickerAvailable: false, fileCount: 3 })).toBe(false);
  });

  it("surfaces text error bodies from download presign responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("An error occurred while preparing the download.", {
          status: 500,
          headers: { "content-type": "text/plain" },
        })
      )
    );

    const { getPresignedDownloadUrl } = await import("@/lib/client/media-download");

    await expect(getPresignedDownloadUrl("transfers/demo/originals/file.jpg", "file.jpg")).rejects.toThrow(
      "An error occurred while preparing the download."
    );
  });

  it("returns the presigned url when the response body is valid json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ url: "https://example.com/download" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const { getPresignedDownloadUrl } = await import("@/lib/client/media-download");

    await expect(getPresignedDownloadUrl("transfers/demo/originals/file.jpg", "file.jpg")).resolves.toBe(
      "https://example.com/download"
    );
  });
});
