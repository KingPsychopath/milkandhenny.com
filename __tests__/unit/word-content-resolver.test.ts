import { describe, expect, it } from "vitest";
import { getTransferFileUrl, resolveWordContentRef } from "@/features/media/storage";

describe("word content resolver", () => {
  it("maps typed legacy-style media path to words/media", () => {
    const result = resolveWordContentRef(
      "blog/on-being-featured/dsc00003.webp",
      "on-being-featured"
    );
    expect(result).toContain("/words/media/on-being-featured/dsc00003.webp");
  });

  it("encodes transfer filenames when building original download URLs", () => {
    const result = getTransferFileUrl("velvet-moon-candle", "party #1?.png");

    expect(result).toContain(
      "/transfers/velvet-moon-candle/original/party%20%231%3F.png"
    );
  });
});
