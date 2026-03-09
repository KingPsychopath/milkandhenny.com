import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildZipArchive, resolveArchiveFilenames } from "@/lib/client/streaming-zip";

function readUint64(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

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

  it("writes Zip64 records and sentinels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4]));
              controller.close();
            },
          })
        )
      )
    );

    const result = await buildZipArchive({
      files: [{ id: "1", filename: "photo.jpg", url: "https://example.com/a" }],
    });

    expect(result.type).toBe("blob");
    if (result.type !== "blob") throw new Error("Expected blob result");

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(18, true)).toBe(0xffffffff);
    expect(view.getUint32(22, true)).toBe(0xffffffff);
    expect(view.getUint16(28, true)).toBe(20);
    expect(view.getUint16(39, true)).toBe(0x0001);
    expect(view.getUint16(41, true)).toBe(16);

    const eocdOffset = bytes.length - 22;
    const locatorOffset = eocdOffset - 20;
    const zip64Offset = locatorOffset - 56;

    expect(view.getUint32(zip64Offset, true)).toBe(0x06064b50);
    expect(readUint64(view, zip64Offset + 4)).toBe(44);
    expect(view.getUint16(zip64Offset + 12, true)).toBe(45);
    expect(readUint64(view, zip64Offset + 24)).toBe(1);
    expect(readUint64(view, zip64Offset + 32)).toBe(1);

    expect(view.getUint32(locatorOffset, true)).toBe(0x07064b50);
    expect(readUint64(view, locatorOffset + 8)).toBe(zip64Offset);

    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(eocdOffset + 8, true)).toBe(0xffff);
    expect(view.getUint16(eocdOffset + 10, true)).toBe(0xffff);
    expect(view.getUint32(eocdOffset + 12, true)).toBe(0xffffffff);
    expect(view.getUint32(eocdOffset + 16, true)).toBe(0xffffffff);
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

  it("honors abort signals", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Download cancelled", "AbortError"));

    await expect(
      buildZipArchive({
        files: [{ id: "1", filename: "photo.jpg", url: "https://example.com/a" }],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
