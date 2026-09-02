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

  it("allows a progressing upload to run beyond two minutes", async () => {
    let finishUpload: ((response: Response) => void) | undefined;
    let uploadSignal: AbortSignal | null | undefined;
    const request = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          uploadSignal = init?.signal;
          finishUpload = resolve;
        }),
    );
    vi.stubGlobal("fetch", request);

    const pending = uploadPresignedObject({
      url: "https://bucket.example/large-upload?signature=test",
      body: new Blob(["archive"]),
      contentType: "application/zip",
    });

    await vi.advanceTimersByTimeAsync(120_001);

    expect(uploadSignal?.aborted).toBe(false);
    finishUpload?.(new Response(null, { status: 200 }));
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("reports uploaded bytes while preserving the signed PUT request", async () => {
    const progress = vi.fn();
    const xhr = {
      upload: {
        onprogress: null as ((event: ProgressEvent) => void) | null,
      },
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      getAllResponseHeaders: vi.fn(() => "etag: uploaded\r\n"),
      responseType: "",
      response: new Blob(),
      status: 200,
      statusText: "OK",
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      abort: vi.fn(),
      send: vi.fn((body: Blob) => {
        xhr.upload.onprogress?.({
          loaded: 4,
          total: body.size,
          lengthComputable: true,
        } as ProgressEvent);
        xhr.onload?.();
      }),
    };
    function FakeXMLHttpRequest() {
      return xhr;
    }
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const response = await uploadPresignedObject(
      {
        url: "https://bucket.example/upload?signature=test",
        body: new Blob(["12345678"]),
        contentType: "application/zip",
      },
      { retries: 0, onProgress: progress },
    );

    expect(response.status).toBe(200);
    expect(xhr.open).toHaveBeenCalledWith("PUT", expect.stringContaining("signature=test"));
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("content-type", "application/zip");
    expect(progress.mock.calls).toEqual([
      [0, 8],
      [4, 8],
      [8, 8],
    ]);
  });

  it("aborts an inactive storage upload instead of hanging at zero", async () => {
    const progress = vi.fn();
    const attempts = vi.fn();
    const xhr = {
      upload: {
        onprogress: null as ((event: ProgressEvent) => void) | null,
      },
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      getAllResponseHeaders: vi.fn(() => ""),
      responseType: "",
      response: new Blob(),
      status: 0,
      statusText: "",
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      abort: vi.fn(() => xhr.onabort?.()),
      send: vi.fn(),
    };
    function FakeXMLHttpRequest() {
      return xhr;
    }
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const pending = uploadPresignedObject(
      {
        url: "https://bucket.example/upload?signature=test",
        body: new Blob(["archive"]),
        contentType: "application/zip",
      },
      {
        retries: 0,
        stallTimeoutMs: 1_000,
        onProgress: progress,
        onAttempt: attempts,
      },
    );
    const rejection = expect(pending).rejects.toThrow("Upload stalled while waiting for storage");

    await vi.advanceTimersByTimeAsync(1_001);
    await rejection;

    expect(attempts).toHaveBeenCalledWith(1, 1);
    expect(progress).toHaveBeenCalledWith(0, 7);
    expect(xhr.abort).toHaveBeenCalledOnce();
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
