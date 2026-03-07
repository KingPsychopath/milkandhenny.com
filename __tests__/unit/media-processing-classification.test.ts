import { describe, expect, it } from "vitest";
import { getFileKind, getMimeType } from "@/features/media/processing";

describe("media processing classification", () => {
  it("treats camera raw files as visual images", () => {
    expect(getFileKind("IMG_2869.dng")).toBe("image");
    expect(getFileKind("DSC0001.ARW")).toBe("image");
    expect(getFileKind("capture.cr3")).toBe("image");
  });

  it("assigns specific mime types for common raw formats", () => {
    expect(getMimeType("IMG_2869.dng")).toBe("image/x-adobe-dng");
    expect(getMimeType("capture.cr3")).toBe("image/x-canon-cr3");
    expect(getMimeType("photo.nef")).toBe("image/x-nikon-nef");
  });
});
