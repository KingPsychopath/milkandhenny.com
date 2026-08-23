import { readFile } from "node:fs/promises";

import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) =>
    skeletons.map((skeleton, index) => ({
      ...skeleton,
      id: `imported_${index}`,
      version: 1,
      isDeleted: false,
    })),
}));

describe("PowerPoint import", () => {
  beforeAll(() => {
    vi.stubGlobal("DOMParser", DOMParser);
  });

  it("reads slide order and common editable text from a real PowerPoint file", async () => {
    const bytes = await readFile(new URL("../fixtures/pitch-import-smoke.pptx", import.meta.url));
    const file = Object.assign(new Uint8Array(bytes), {
      name: "pitch-import-smoke.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }) as unknown as File;
    const { importPptx } = await import("@/features/things/pitches/import.client");

    const slides = await importPptx(file, 12);

    expect(slides).toHaveLength(2);
    expect(slides.map((slide) => slide.name)).toEqual(["PowerPoint 1", "PowerPoint 2"]);
    expect(slides[0].elements.map((element) => ("text" in element ? element.text : null))).toEqual(
      expect.arrayContaining([
        "A simple imported story",
        "Text should remain editable after PowerPoint import.",
      ]),
    );
    expect(slides[1].elements.map((element) => ("text" in element ? element.text : null))).toEqual(
      expect.arrayContaining([
        "The second slide keeps its order",
        "A common text box and a native shape give the importer two ordinary PowerPoint objects to interpret.",
      ]),
    );
    expect(slides.every((slide) => slide.mediaFiles.length === 0)).toBe(true);
  });
});
