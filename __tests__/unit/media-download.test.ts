import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchContentLength, getZipDownloadErrorMessage } from "@/lib/client/media-download";

describe("media download helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads content-length from a HEAD response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200, headers: { "content-length": "12345" } }))
    );

    await expect(fetchContentLength("https://example.com/file.jpg")).resolves.toBe(12345);
  });

  it("returns null when content-length is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 }))
    );

    await expect(fetchContentLength("https://example.com/file.jpg")).resolves.toBeNull();
  });

  it("maps disk-full write errors to a user-facing message", () => {
    expect(
      getZipDownloadErrorMessage(
        new DOMException("The requested operation failed", "QuotaExceededError"),
        "fallback"
      )
    ).toBe("Download failed: not enough disk space.");
  });
});
