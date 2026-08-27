import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPresignedObject } from "@/lib/client/presigned-upload";

describe("presigned upload transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the exact signed headers and retries a transient failure", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", request);
    const body = new Blob(["hello"], { type: "image/webp" });

    const pending = uploadPresignedObject({
      url: "https://bucket.example/upload?signature=test",
      body,
      contentType: "image/webp",
      cacheControl: "private, no-store",
    });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(request).toHaveBeenCalledTimes(2);
    const init = request.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(body);
    expect(headers.get("content-type")).toBe("image/webp");
    expect(headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not retry a rejected 4xx upload", async () => {
    const request = vi.fn(async () => new Response("forbidden", { status: 403 }));
    vi.stubGlobal("fetch", request);

    const response = await uploadPresignedObject({
      url: "https://bucket.example/upload?signature=test",
      body: new Blob(["hello"]),
      contentType: "application/octet-stream",
    });

    expect(response.status).toBe(403);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects non-http destinations before sending bytes", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    await expect(
      uploadPresignedObject({
        url: "javascript:alert(1)",
        body: new Blob(["hello"]),
        contentType: "text/plain",
      }),
    ).rejects.toThrow("unsupported destination URL");
    expect(request).not.toHaveBeenCalled();
  });
});
