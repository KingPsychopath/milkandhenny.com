import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";

import { putPresignedFile, uploadPresignedFiles } from "../../scripts/transfer-presigned-upload";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mah-transfer-upload-"));

afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

it("streams a source file to the signed target with its declared MIME type", async () => {
  fs.writeFileSync(path.join(dir, "note.txt"), "hello");
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    const chunks: Buffer[] = [];
    for await (const chunk of options.body as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
    calls.push({
      url,
      body: Buffer.concat(chunks).toString(),
      headers: options.headers as Record<string, string>,
    });
    return new Response(null, { status: 200 });
  });

  const file = { name: "note.txt", mediaId: "note", size: 5 };
  const result = await uploadPresignedFiles(
    dir,
    [file],
    [
      {
        name: file.name,
        mediaId: file.mediaId,
        contentType: "text/plain",
        primaryUrl: "https://upload.invalid/note",
      },
    ],
    [],
  );
  expect(result).toEqual([file]);
  expect(calls).toEqual([
    {
      url: "https://upload.invalid/note",
      body: "hello",
      headers: { "content-length": "5", "content-type": "text/plain" },
    },
  ]);
});

it("streams multipart byte ranges and passes provider ETags to finalization", async () => {
  fs.writeFileSync(path.join(dir, "part.bin"), "abcdefg");
  const bodies: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    const chunks: Buffer[] = [];
    for await (const chunk of options.body as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks).toString());
    return new Response(null, { status: 200, headers: { etag: `etag-${bodies.length}` } });
  });

  const file = { name: "part.bin", mediaId: "part", size: 7 };
  const result = await putPresignedFile(dir, file, {
    name: file.name,
    mediaId: file.mediaId,
    contentType: "application/octet-stream",
    multipart: {
      uploadId: "upload-1",
      partSize: 3,
      parts: [1, 2, 3].map((partNumber) => ({
        partNumber,
        url: `https://upload.invalid/${partNumber}`,
      })),
    },
  });
  expect(bodies).toEqual(["abc", "def", "g"]);
  expect(result.multipart).toEqual({
    uploadId: "upload-1",
    parts: [1, 2, 3].map((partNumber) => ({ partNumber, etag: `etag-${partNumber}` })),
  });
});
