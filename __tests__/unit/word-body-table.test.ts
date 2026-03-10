import React from "react";
import { describe, expect, it } from "vitest";
import { analyzeTableChildren, extractTableDataFromNode, getOverflowState, shouldDefaultToCompact } from "@/app/(editorial)/words/_components/WordBodyTable";

describe("WordBodyTable helpers", () => {
  it("should keep a small simple table expanded by default", () => {
    const shape = analyzeTableChildren(
      React.createElement("tbody", null,
        React.createElement("tr", null,
          React.createElement("th", null, "Name"),
          React.createElement("th", null, "Role")
        ),
        React.createElement("tr", null,
          React.createElement("td", null, "Ada"),
          React.createElement("td", null, "Host")
        )
      )
    );

    expect(shape).toMatchObject({ columnCount: 2, rowCount: 2 });
    expect(shouldDefaultToCompact(shape)).toBe(false);
  });

  it("should start compact for a wide markdown table", () => {
    const shape = analyzeTableChildren(
      React.createElement("tbody", null,
        React.createElement("tr", null,
          React.createElement("th", null, "Name"),
          React.createElement("th", null, "Role"),
          React.createElement("th", null, "Arrival"),
          React.createElement("th", null, "Drink"),
          React.createElement("th", null, "Notes")
        ),
        React.createElement("tr", null,
          React.createElement("td", null, "Ada"),
          React.createElement("td", null, "Host"),
          React.createElement("td", null, "19:30"),
          React.createElement("td", null, "Negroni"),
          React.createElement("td", null, "Prefers the quieter table near the back wall.")
        )
      )
    );

    expect(shouldDefaultToCompact(shape)).toBe(true);
  });

  it("should extract markdown-friendly export data from the source node", () => {
    const table = {
      tagName: "table",
      children: [
        {
          tagName: "thead",
          children: [
            {
              tagName: "tr",
              children: [
                { tagName: "th", children: [{ type: "text", value: "Name" }] },
                { tagName: "th", children: [{ type: "text", value: "Notes" }] },
              ],
            },
          ],
        },
        {
          tagName: "tbody",
          children: [
            {
              tagName: "tr",
              children: [
                {
                  tagName: "td",
                  children: [
                    {
                      tagName: "a",
                      properties: { href: "/guests/ada" },
                      children: [{ type: "text", value: "Ada" }],
                    },
                  ],
                },
                {
                  tagName: "td",
                  children: [
                    { type: "text", value: "Bring " },
                    { type: "inlineCode", value: "sparkling" },
                    { type: "text", value: " and " },
                    { tagName: "img", properties: { alt: "menu", src: "/menu.png" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(extractTableDataFromNode(table)).toEqual({
      headers: ["Name", "Notes"],
      rows: [["[Ada](/guests/ada)", "Bring `sparkling` and ![menu](/menu.png)"]],
    });
  });

  it("should only show horizontal overflow cues when scroll space remains", () => {
    expect(getOverflowState(0, 600, 600)).toEqual({
      hasHorizontalOverflow: false,
      showOverflowStart: false,
      showOverflowEnd: false,
    });

    expect(getOverflowState(0, 400, 700)).toEqual({
      hasHorizontalOverflow: true,
      showOverflowStart: false,
      showOverflowEnd: true,
    });

    expect(getOverflowState(120, 400, 700)).toEqual({
      hasHorizontalOverflow: true,
      showOverflowStart: true,
      showOverflowEnd: true,
    });

    expect(getOverflowState(300, 400, 700)).toEqual({
      hasHorizontalOverflow: true,
      showOverflowStart: true,
      showOverflowEnd: false,
    });
  });
});
