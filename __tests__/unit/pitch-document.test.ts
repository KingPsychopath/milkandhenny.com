import { describe, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { mergePitchDocuments } from "@/features/things/pitches/merge";
import {
  reconcileLocalPitchDraft,
  type LocalPitchDraft,
} from "@/features/things/pitches/browser-store.client";
import { hasPitchDocumentContent } from "@/features/things/pitches/document-content";
import {
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
} from "@/features/things/pitches/types";
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
        durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
        elements,
        assetIds: {},
        mediaClips: [],
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

  it("treats legacy placeholder marks as an empty pitch", () => {
    const deletedText = {
      ...element("deleted_text", 1, 1),
      type: "text",
      text: "",
      isDeleted: true,
    } as ExcalidrawElement;
    const unfinishedStroke = {
      ...element("unfinished_stroke", 1, 1),
      type: "freedraw",
      points: [[0, 0]],
      width: 0,
      height: 0,
    } as ExcalidrawElement;

    expect(hasPitchDocumentContent(documentWith([deletedText, unfinishedStroke]))).toBe(false);
    expect(hasPitchDocumentContent(documentWith([element("visible_rectangle", 1, 1)]))).toBe(true);
  });

  it("upgrades schema-one audio cues without mutating the stored document", () => {
    const legacy = {
      schemaVersion: 1,
      slides: [
        {
          id: "slide_legacy_1",
          name: "Legacy slide",
          version: 1,
          updatedAt: 100,
          durationMs: 15_000,
          elements: [],
          assetIds: {},
          audioCues: [
            {
              id: "audio_enter_1",
              assetId: "pa_1234567890123456789012",
              trigger: "enter",
              delayMs: 2_000,
              sourceDurationMs: 10_000,
              startAtMs: 1_000,
              playForMs: 4_000,
              volume: 0.8,
              end: "slide-exit",
            },
            {
              id: "audio_exit_1",
              assetId: "pa_1234567890123456789013",
              trigger: "exit",
              delayMs: 0,
              sourceDurationMs: 8_000,
              startAtMs: 0,
              playForMs: 3_000,
              volume: 1,
              end: "clip-end",
            },
          ],
        },
      ],
    };

    const parsed = parsePitchDocument(legacy, 6);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.schemaVersion).toBe(2);
    expect(parsed.document.slides[0].mediaClips).toMatchObject([
      {
        id: "audio_enter_1",
        kind: "audio",
        timelineStartMs: 2_000,
        sourceStartMs: 1_000,
        durationMs: 4_000,
        loop: false,
      },
      {
        id: "audio_exit_1",
        kind: "audio",
        timelineStartMs: 12_000,
        durationMs: 3_000,
        loop: false,
      },
    ]);
    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.slides[0].audioCues).toHaveLength(2);
  });

  it("rejects documents from a future schema", () => {
    expect(parsePitchDocument({ ...documentWith([]), schemaVersion: 3 }, 6)).toEqual({
      ok: false,
      error: "This deck was made by an unsupported studio version",
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
      durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
      elements: [],
      assetIds: {},
      mediaClips: [],
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

  it("keeps media clips inside the slide and source timing boundaries", () => {
    const document = documentWith([]);
    document.slides[0].mediaClips = [
      {
        id: "audio_12345678",
        assetId: "pa_1234567890123456789012",
        kind: "audio",
        timelineStartMs: 2_000,
        sourceDurationMs: 8_000,
        sourceStartMs: 1_000,
        durationMs: 4_000,
        volume: 0.8,
        muted: false,
        loop: false,
        locked: false,
      },
    ];
    expect(parsePitchDocument(document, 6).ok).toBe(true);
    document.slides[0].mediaClips[0].durationMs = 7_500;
    expect(parsePitchDocument(document, 6).ok).toBe(false);
    document.slides[0].mediaClips[0].loop = true;
    expect(parsePitchDocument(document, 6).ok).toBe(true);
  });

  it("keeps video placement inside the fixed slide stage", () => {
    const document = documentWith([]);
    document.slides[0].mediaClips = [
      {
        id: "video_12345678",
        assetId: "pa_1234567890123456789012",
        kind: "video",
        timelineStartMs: 0,
        sourceDurationMs: 8_000,
        sourceStartMs: 0,
        durationMs: 8_000,
        volume: 0.8,
        muted: true,
        loop: false,
        locked: false,
        fit: "cover",
        videoPlacement: { x: 80, y: 45, width: 800, height: 450, layer: 0 },
      },
    ];
    expect(parsePitchDocument(document, 6).ok).toBe(true);
    document.slides[0].mediaClips[0].videoPlacement!.width = 900;
    expect(parsePitchDocument(document, 6)).toEqual({
      ok: false,
      error: "The deck contains an invalid slide",
    });
  });

  it("recovers unsynced local edits after another device advances the server", () => {
    const remoteDocument = documentWith([element("remote_object", 1, 20)]);
    const localDocument = documentWith([element("local_object", 1, 10)]);
    const remote = {
      id: "p_1234567890123456789012",
      title: "Remote title",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      lifecycle: "active" as const,
      document: remoteDocument,
      version: 3,
      updatedAt: new Date().toISOString(),
      draftExpiresAt: new Date().toISOString(),
      assets: [],
    };
    const local: LocalPitchDraft = {
      deckId: remote.id,
      title: "Local title",
      document: localDocument,
      files: {},
      pendingSync: true,
      updatedAt: new Date().toISOString(),
    };

    const recovered = reconcileLocalPitchDraft(remote, local);

    expect(recovered.pendingSync).toBe(true);
    expect(recovered.title).toBe("Local title");
    expect(recovered.document.slides[0].elements.map(({ id }) => id)).toEqual([
      "local_object",
      "remote_object",
    ]);
  });

  it("uses the server copy when the local draft has no pending work", () => {
    const remoteDocument = documentWith([element("remote_object", 1, 20)]);
    const remote = {
      id: "p_1234567890123456789012",
      title: "Remote title",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      lifecycle: "active" as const,
      document: remoteDocument,
      version: 3,
      updatedAt: new Date().toISOString(),
      draftExpiresAt: new Date().toISOString(),
      assets: [],
    };
    const local: LocalPitchDraft = {
      deckId: remote.id,
      title: "Stale title",
      document: documentWith([element("stale_object", 1, 10)]),
      files: {},
      pendingSync: false,
      updatedAt: new Date().toISOString(),
    };

    expect(reconcileLocalPitchDraft(remote, local)).toEqual({
      title: remote.title,
      document: remote.document,
      pendingSync: false,
    });
  });
});
