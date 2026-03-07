import { describe, expect, it } from "vitest";
import { buildLivePhotoVisualItems } from "@/features/transfers/live-photo";

describe("live photo pairing", () => {
  it("pairs image and video with the same stem", () => {
    const items = buildLivePhotoVisualItems([
      { id: "a", filename: "IMG_1234.jpg", kind: "image" as const },
      { id: "b", filename: "IMG_1234.mov", kind: "video" as const },
      { id: "c", filename: "IMG_9999.jpg", kind: "image" as const },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "live",
      photo: { id: "a" },
      motion: { id: "b" },
    });
    expect(items[1]).toMatchObject({
      type: "single",
      file: { id: "c" },
    });
  });

  it("does not pair RAW images with videos", () => {
    const items = buildLivePhotoVisualItems([
      { id: "a", filename: "DSC0001.ARW", kind: "image" as const },
      { id: "b", filename: "DSC0001.mov", kind: "video" as const },
    ]);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type === "single")).toBe(true);
  });
});
