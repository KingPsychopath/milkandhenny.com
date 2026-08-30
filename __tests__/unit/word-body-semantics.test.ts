import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WordBody } from "@/features/words/components/ui/WordBody";

describe("word body semantics", () => {
  it("demotes imported top-level headings so the page keeps a single h1", () => {
    const html = renderToStaticMarkup(
      React.createElement(WordBody, { content: "# Imported title\n\nBody copy." }),
    );

    expect(html).not.toContain("<h1");
    expect(html).toContain('<h2 id="imported-title">Imported title</h2>');
  });
});
