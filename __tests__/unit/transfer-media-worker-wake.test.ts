import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("transfer media worker wake", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts to the configured wake endpoint with the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TRANSFER_MEDIA_WAKE_URL", "https://example.workers.dev/wake");
    vi.stubEnv("TRANSFER_MEDIA_WAKE_TOKEN", "secret-token");

    const { wakeMediaWorker } = await import("@/features/system/media-worker-wake.server");
    await expect(wakeMediaWorker()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.workers.dev/wake",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer secret-token",
        },
      }),
    );
  });

  it("returns false without calling fetch when the wake URL is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TRANSFER_MEDIA_WAKE_URL", "");
    vi.stubEnv("TRANSFER_MEDIA_WAKE_TOKEN", "");

    const { wakeMediaWorker } = await import("@/features/system/media-worker-wake.server");
    await expect(wakeMediaWorker()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
