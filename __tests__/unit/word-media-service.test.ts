import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  cleanup: vi.fn().mockResolvedValue(undefined),
  finish: vi.fn().mockResolvedValue({ uploaded: [], skipped: [], queuedCount: 0 }),
  process: vi.fn().mockResolvedValue({
    original: "notes.pdf",
    filename: "notes.pdf",
    kind: "file",
    size: 5,
    markdown: "[notes](notes.pdf)",
    overwrote: false,
  }),
  scope: vi.fn().mockResolvedValue("public"),
  verify: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/features/words/media-storage.server", () => ({
  getWordMediaStorageScope: operations.scope,
}));

vi.mock("@/features/words/word-media-operations.server", () => ({
  cleanupWordMediaStagingFile: operations.cleanup,
  finishWordMediaMetadata: operations.finish,
  processWordMediaFile: operations.process,
  verifyWordMediaFile: operations.verify,
}));

import { WordMediaService } from "@/features/words/word-media-service.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";

const file = {
  original: "notes.pdf",
  filename: "notes.pdf",
  uploadKey: "words/incoming/test/notes.pdf",
  size: 5,
  kind: "file" as const,
  overwrote: false,
};

function runFinalize() {
  const storageLayer = Layer.succeed(ObjectStorageService, { port: {} as never } as never);
  const layer = WordMediaService.layer.pipe(Layer.provide(storageLayer));
  return Effect.runPromise(
    WordMediaService.use((service) =>
      service.finalize({
        target: { scope: "asset", assetId: "test" },
        files: [file],
        skipped: ["ignored.txt"],
      }),
    ).pipe(Effect.provide(layer)),
  );
}

describe("word media Effect service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.cleanup.mockResolvedValue(undefined);
    operations.finish.mockResolvedValue({ uploaded: [], skipped: [], queuedCount: 0 });
    operations.process.mockResolvedValue({
      original: "notes.pdf",
      filename: "notes.pdf",
      kind: "file",
      size: 5,
      markdown: "[notes](notes.pdf)",
      overwrote: false,
    });
    operations.scope.mockResolvedValue("public");
    operations.verify.mockResolvedValue(null);
  });

  it("processes a batch and always cleans its staging objects", async () => {
    await expect(runFinalize()).resolves.toMatchObject({
      status: "completed",
      value: { skipped: ["ignored.txt"] },
    });
    expect(operations.verify).toHaveBeenCalledWith(file);
    expect(operations.process).toHaveBeenCalledWith(
      { scope: "asset", assetId: "test" },
      "public",
      file,
    );
    expect(operations.cleanup).toHaveBeenCalledWith({ scope: "asset", assetId: "test" }, file);
  });

  it("still cleans staging when processing fails", async () => {
    operations.process.mockRejectedValueOnce(new Error("conversion failed"));

    await expect(runFinalize()).rejects.toMatchObject({
      _tag: "WordMediaOperationError",
      operation: "process_file",
    });
    expect(operations.cleanup).toHaveBeenCalledOnce();
  });

  it("returns a known verification failure without processing the batch", async () => {
    operations.verify.mockResolvedValueOnce("upload size did not match");

    await expect(runFinalize()).resolves.toEqual({
      status: "verification-failed",
      error: "upload size did not match",
    });
    expect(operations.process).not.toHaveBeenCalled();
    expect(operations.cleanup).toHaveBeenCalledOnce();
  });
});
