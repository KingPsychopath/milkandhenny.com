import { describe, expect, it } from "vitest";
import { serializeJsonForHtml } from "@/lib/shared/serialize-json-for-html";

describe("serializeJsonForHtml", () => {
  it("prevents JSON data from terminating an inline script", () => {
    const value = { title: "</script><script>alert(1)</script>\u2028&" };

    const serialized = serializeJsonForHtml(value);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).not.toContain("\u2028");
    expect(JSON.parse(serialized)).toEqual(value);
  });

  it("preserves ordinary structured data", () => {
    const value = { "@type": "Article", headline: "Milk & Henny" };
    expect(JSON.parse(serializeJsonForHtml(value))).toEqual(value);
  });
});
