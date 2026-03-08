import { describe, expect, it } from "vitest";
import { buildTransferVisualItems, inferTransferAssetGroups } from "@/features/transfers/live-photo";

describe("transfer asset grouping", () => {
  it("infers a live photo group from matching still and motion files", () => {
    const grouped = inferTransferAssetGroups([
      { id: "a", filename: "IMG_1234.jpg", kind: "image" as const, mimeType: "image/jpeg" },
      { id: "b", filename: "IMG_1234.mov", kind: "video" as const, mimeType: "video/quicktime" },
      { id: "c", filename: "IMG_9999.jpg", kind: "image" as const, mimeType: "image/jpeg" },
    ]);

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      type: "live_photo",
      members: [
        { fileId: "a", role: "primary" },
        { fileId: "b", role: "motion" },
      ],
    });
    expect(grouped.files.find((file) => file.id === "a")).toMatchObject({ groupRole: "primary" });
    expect(grouped.files.find((file) => file.id === "b")).toMatchObject({ groupRole: "motion" });
  });

  it("does not pair RAW images with videos", () => {
    const grouped = inferTransferAssetGroups([
      { id: "a", filename: "DSC0001.ARW", kind: "image" as const, mimeType: "image/x-sony-arw" },
      { id: "b", filename: "DSC0001.mov", kind: "video" as const, mimeType: "video/quicktime" },
    ]);

    expect(grouped.groups).toHaveLength(0);
    expect(grouped.files.every((file) => !file.groupId)).toBe(true);
  });

  it("infers a raw pair and prefers a HEIF still as primary", () => {
    const grouped = inferTransferAssetGroups([
      { id: "raw", filename: "DSC0001.ARW", kind: "image" as const, mimeType: "image/x-sony-arw" },
      { id: "jpg", filename: "DSC0001.JPG", kind: "image" as const, mimeType: "image/jpeg" },
      { id: "heif", filename: "DSC0001.HIF", kind: "image" as const, mimeType: "image/heif" },
    ]);

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      type: "raw_pair",
      members: [
        { fileId: "heif", role: "primary" },
        { fileId: "raw", role: "raw" },
      ],
    });
    expect(grouped.files.find((file) => file.id === "jpg")?.groupId).toBeUndefined();
  });

  it("uses persisted groups when building visual items", () => {
    const items = buildTransferVisualItems(
      [
        { id: "still", filename: "IMG_1234.jpg", kind: "image" as const, mimeType: "image/jpeg" },
        { id: "motion", filename: "IMG_1234.mov", kind: "video" as const, mimeType: "video/quicktime" },
      ],
      [
        {
          id: "live_photo:primary:still:motion:motion",
          type: "live_photo",
          members: [
            { fileId: "still", role: "primary", mimeType: "image/jpeg" },
            { fileId: "motion", role: "motion", mimeType: "video/quicktime" },
          ],
        },
      ]
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "live_photo",
      photo: { id: "still" },
      motion: { id: "motion" },
    });
  });
});
