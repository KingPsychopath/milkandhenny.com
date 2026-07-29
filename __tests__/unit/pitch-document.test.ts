import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { mergePitchDocuments } from "@/features/things/pitches/merge";
import { PITCH_DOCUMENT_SCHEMA_VERSION, type PitchDocument } from "@/features/things/pitches/types";
import { parsePitchDocument } from "@/features/things/pitches/validation";

function element(id: string, version: number, updated: number): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    version,
    versionNonce: version * 10,
    updated,
    isDeleted: false,
  } as ExcalidrawElement;
}

function documentWith(elements: readonly ExcalidrawElement[]): PitchDocument {
  return {
    schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION,
    slides: [
      {
        id: "slide_123456",
        name: "Slide 1",
        version: 1,
        updatedAt: 100,
        elements,
        assetIds: {},
      },
    ],
  };
}

describe("pitch documents", () => {
  it("accepts the stable editor fields and rejects active-content elements", () => {
    expect(parsePitchDocument(documentWith([element("object_123", 1, 1)]), 6).ok).toBe(true);
    const embeddable = {
      ...element("object_456", 1, 1),
      type: "embeddable",
    } as ExcalidrawElement;
    expect(parsePitchDocument(documentWith([embeddable]), 6)).toEqual({
      ok: false,
      error: "The deck contains an invalid slide",
    });
  });

  it("consolidates independent objects from stale devices", () => {
    const server = documentWith([element("server_object", 1, 10)]);
    const incoming = documentWith([element("phone_object", 1, 20)]);
    incoming.slides[0].version = 2;
    incoming.slides[0].updatedAt = 200;

    const merged = mergePitchDocuments(server, incoming);
    expect(merged.slides[0].elements.map(({ id }) => id)).toEqual([
      "phone_object",
      "server_object",
    ]);
  });

  it("keeps the newest version of the same editor object", () => {
    const server = documentWith([element("same_object", 4, 40)]);
    const incoming = documentWith([element("same_object", 3, 90)]);
    expect(mergePitchDocuments(server, incoming).slides[0].elements[0].version).toBe(4);
  });

  it("does not resurrect a slide deleted on another device", () => {
    const server = documentWith([]);
    const incoming = documentWith([]);
    server.slides[0].deletedAt = 300;
    server.slides.push({
      id: "slide_backup",
      name: "Slide 2",
      version: 1,
      updatedAt: 100,
      elements: [],
      assetIds: {},
    });
    incoming.slides.push(server.slides[1]);
    expect(mergePitchDocuments(server, incoming).slides[0].deletedAt).toBe(300);
  });

  it("bounds tactile ink data before it reaches storage", () => {
    const document = documentWith([]);
    document.slides[0].inkLayers = [
      {
        id: "ink_12345678",
        name: "Beautiful ink",
        board: { w: 1200, h: 675 },
        fileId: "ink_file_123",
        updatedAt: Date.now(),
        strokes: [
          {
            id: 1,
            pen: "fountain",
            color: "black",
            size: 8,
            opacity: 1,
            points: [
              [0, 0, 0.5],
              [20, 20, 0.8],
            ],
          },
        ],
      },
    ];
    expect(parsePitchDocument(document, 6).ok).toBe(true);
    document.slides[0].inkLayers[0].board.w = 50_000;
    expect(parsePitchDocument(document, 6).ok).toBe(false);
  });
});
