import { describe, expect, it } from "vitest";
import {
  getMultipartArchiveName,
  partitionFilesBySize,
  planZipDownload,
} from "@/lib/client/zip-planner";

describe("zip planner", () => {
  const maxPartBytes = 200;

  it("partitions files within the size boundary and preserves order", () => {
    const parts = partitionFilesBySize(
      [
        { id: "a", filename: "a.jpg", url: "a", size: 120 },
        { id: "b", filename: "b.jpg", url: "b", size: 80 },
        { id: "c", filename: "c.jpg", url: "c", size: 50 },
      ],
      maxPartBytes
    );

    expect(parts).toHaveLength(2);
    expect(parts[0].files.map((file) => file.id)).toEqual(["a", "b"]);
    expect(parts[1].files.map((file) => file.id)).toEqual(["c"]);
    expect(parts[0].total).toEqual({ known: true, bytes: 200 });
    expect(parts[1].total).toEqual({ known: true, bytes: 50 });
  });

  it("keeps unknown-size files in their own parts", () => {
    const parts = partitionFilesBySize(
      [
        { id: "a", filename: "a.jpg", url: "a", size: 120 },
        { id: "b", filename: "b.jpg", url: "b" },
        { id: "c", filename: "c.jpg", url: "c", size: 50 },
      ],
      maxPartBytes
    );

    expect(parts).toHaveLength(3);
    expect(parts[0].total).toEqual({ known: true, bytes: 120 });
    expect(parts[1].total).toEqual({ known: false });
    expect(parts[2].total).toEqual({ known: true, bytes: 50 });
  });

  it("returns streaming-single for picker browsers even with oversize files", () => {
    expect(
      planZipDownload(
        [{ id: "a", filename: "big.mov", url: "a", size: 500 }],
        { pickerAvailable: true, maxPartBytes }
      )
    ).toEqual({
      mode: "streaming-single",
      total: { known: true, bytes: 500 },
    });
  });

  it("returns oversize-file for blob browsers with a file above the cap", () => {
    expect(
      planZipDownload(
        [{ id: "a", filename: "big.mov", url: "a", size: 500 }],
        { pickerAvailable: false, maxPartBytes }
      )
    ).toEqual({
      mode: "oversize-file",
      filename: "big.mov",
      bytes: 500,
    });
  });

  it("returns blob-single when all sizes are known and under the cap", () => {
    expect(
      planZipDownload(
        [
          { id: "a", filename: "a.jpg", url: "a", size: 100 },
          { id: "b", filename: "b.jpg", url: "b", size: 50 },
        ],
        { pickerAvailable: false, maxPartBytes }
      )
    ).toEqual({
      mode: "blob-single",
      total: { known: true, bytes: 150 },
    });
  });

  it("returns blob-multipart when the known total exceeds the cap", () => {
    const plan = planZipDownload(
      [
        { id: "a", filename: "a.jpg", url: "a", size: 120 },
        { id: "b", filename: "b.jpg", url: "b", size: 100 },
      ],
      { pickerAvailable: false, maxPartBytes }
    );

    expect(plan.mode).toBe("blob-multipart");
    if (plan.mode !== "blob-multipart") throw new Error("Expected multipart plan");
    expect(plan.total).toEqual({ known: true, bytes: 220 });
    expect(plan.partCount).toBe(2);
    expect(plan.partBytes).toEqual([{ known: true, bytes: 120 }, { known: true, bytes: 100 }]);
  });

  it("returns blob-multipart when sizes are unknown and known bytes are below the cap", () => {
    const plan = planZipDownload(
      [
        { id: "a", filename: "a.jpg", url: "a", size: 100 },
        { id: "b", filename: "b.jpg", url: "b" },
      ],
      { pickerAvailable: false, maxPartBytes }
    );

    expect(plan.mode).toBe("blob-multipart");
    if (plan.mode !== "blob-multipart") throw new Error("Expected multipart plan");
    expect(plan.total).toEqual({ known: false });
    expect(plan.partCount).toBe(2);
  });

  it("returns blob-multipart when sizes are unknown and known bytes already exceed the cap", () => {
    const plan = planZipDownload(
      [
        { id: "a", filename: "a.jpg", url: "a", size: 210 },
        { id: "b", filename: "b.jpg", url: "b" },
      ],
      { pickerAvailable: false, maxPartBytes: 250 }
    );

    expect(plan.mode).toBe("blob-multipart");
    if (plan.mode !== "blob-multipart") throw new Error("Expected multipart plan");
    expect(plan.total).toEqual({ known: false });
    expect(plan.partCount).toBe(2);
  });

  it("builds deterministic multipart archive names", () => {
    expect(getMultipartArchiveName("transfer-1.zip", 2, 4)).toBe("transfer-1-part-2-of-4.zip");
    expect(getMultipartArchiveName("transfer-1", 1, 3)).toBe("transfer-1-part-1-of-3.zip");
  });
});
