import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildZipArchive, resolveArchiveFilenames } from "@/lib/client/streaming-zip";

describe("streaming zip", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams files into a readable zip archive with unique duplicate names", async () => {
    const payloads = new Map<string, string>([
      ["https://example.com/a", "alpha"],
      ["https://example.com/b", "beta"],
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const body = payloads.get(url);
        if (!body) return new Response("missing", { status: 404 });

        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            },
          })
        );
      })
    );

    const result = await buildZipArchive({
      files: [
        { id: "1", filename: "photo.jpg", url: "https://example.com/a" },
        { id: "2", filename: "photo.jpg", url: "https://example.com/b" },
      ],
    });

    expect(result.type).toBe("blob");
    if (result.type !== "blob") throw new Error("Expected blob result");

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    await expect(zip.file("photo.jpg")?.async("string")).resolves.toBe("alpha");
    await expect(zip.file("photo (2).jpg")?.async("string")).resolves.toBe("beta");
  });

  it("resolves duplicate filenames deterministically", () => {
    expect(
      Array.from(
        resolveArchiveFilenames([
          { id: "1", filename: "clip.mp4", url: "a" },
          { id: "2", filename: "clip.mp4", url: "b" },
          { id: "3", filename: "clip", url: "c" },
          { id: "4", filename: "clip", url: "d" },
        ]).entries()
      )
    ).toEqual([
      ["1", "clip.mp4"],
      ["2", "clip (2).mp4"],
      ["3", "clip"],
      ["4", "clip (2)"],
    ]);
  });
});
