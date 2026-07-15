import { describe, expect, it } from "vitest";
import { getTransferOriginalUrl, resolveWordContentRef } from "@/features/media/storage";

describe("word content resolver", () => {
  it("maps typed legacy-style media path to words/media", () => {
    const result = resolveWordContentRef(
      "blog/on-being-featured/dsc00003.webp",
      "on-being-featured",
    );
    expect(result).toContain("/words/media/on-being-featured/dsc00003.webp");
  });

  it("builds protected transfer download URLs", () => {
    const result = getTransferOriginalUrl("transfer/id", "file id", true);

    expect(result).toBe("/api/transfers/transfer%2Fid/media/file%20id/original?download=1");
  });
});
