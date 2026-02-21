import { describe, expect, it } from "vitest";
import { buildWordShareUrl, wordPathForVisibility, wordPrivatePath, wordPublicPath } from "@/features/words/routes";

describe("word routes", () => {
  it("returns public and private paths by visibility", () => {
    expect(wordPublicPath("hello-world")).toBe("/words/hello-world");
    expect(wordPrivatePath("secret-note")).toBe("/vault/secret-note");
    expect(wordPathForVisibility("post", "public")).toBe("/words/post");
    expect(wordPathForVisibility("post", "unlisted")).toBe("/words/post");
    expect(wordPathForVisibility("post", "private")).toBe("/vault/post");
  });

  it("builds canonical share URLs for each visibility", () => {
    expect(buildWordShareUrl("https://milkandhenny.com", "my-post", "abc123", "public")).toBe(
      "https://milkandhenny.com/words/my-post?share=abc123"
    );
    expect(buildWordShareUrl("https://milkandhenny.com/", "my-note", "abc123", "private")).toBe(
      "https://milkandhenny.com/vault/my-note?share=abc123"
    );
  });
});
