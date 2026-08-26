import { describe, expect, it } from "vitest";
import { getFileKind, getMimeType, isProcessableImage } from "@/features/media/processing.server";

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

  it("accepts AVIF as a processable image input", () => {
    expect(getFileKind("portrait.avif")).toBe("image");
    expect(getMimeType("portrait.avif")).toBe("image/avif");
    expect(isProcessableImage("portrait.avif")).toBe(true);
  });
});
