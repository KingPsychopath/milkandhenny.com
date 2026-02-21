import { describe, expect, it } from "vitest";
import { resolveWordContentRef } from "@/features/media/storage";

describe("word content resolver", () => {
  it("maps typed legacy-style media path to words/media", () => {
    const result = resolveWordContentRef(
      "blog/on-being-featured/dsc00003.webp",
      "on-being-featured"
    );
    expect(result).toContain("/words/media/on-being-featured/dsc00003.webp");
  });
});
