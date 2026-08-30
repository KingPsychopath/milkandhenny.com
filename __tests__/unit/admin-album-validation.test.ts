import { describe, expect, it } from "vitest";

import { isSafePhotoId, isValidAlbumDate, normalisePhotoId } from "@/features/media/admin-albums";

describe("admin album validation", () => {
  it("accepts real calendar dates and rejects rollover dates or truncated input", () => {
    expect(isValidAlbumDate("2028-02-29")).toBe(true);
    expect(isValidAlbumDate("2027-02-29")).toBe(false);
    expect(isValidAlbumDate("2026-13-01")).toBe(false);
    expect(isValidAlbumDate("2026-03-08-extra")).toBe(false);
  });

  it("normalises punctuation-heavy filenames into storage-safe photo ids", () => {
    expect(normalisePhotoId(".portrait..final.JPG")).toBe("portrait.final");
    expect(normalisePhotoId("___party___.png")).toBe("party");
    expect(isSafePhotoId(normalisePhotoId(".portrait..final.JPG"))).toBe(true);
  });

  it("rejects photo ids that object storage would treat as traversal-like", () => {
    expect(isSafePhotoId("portrait..final")).toBe(false);
    expect(isSafePhotoId("portrait.final")).toBe(true);
  });
});
