import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type { PitchDocument, PitchSlide } from "./types";

function elementWins(left: ExcalidrawElement, right: ExcalidrawElement): ExcalidrawElement {
  if (right.version !== left.version) return right.version > left.version ? right : left;
  if (right.updated !== left.updated) return right.updated > left.updated ? right : left;
  return right.versionNonce >= left.versionNonce ? right : left;
}

function mergeElements(
  serverElements: readonly ExcalidrawElement[],
  incomingElements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] {
  const incomingOrder = new Map(incomingElements.map((element, index) => [element.id, index]));
  const byId = new Map<string, ExcalidrawElement>();
  for (const element of serverElements) byId.set(element.id, element);
  for (const element of incomingElements) {
    const current = byId.get(element.id);
    byId.set(element.id, current ? elementWins(current, element) : element);
  }
  return [...byId.values()].sort((left, right) => {
    const leftOrder = incomingOrder.get(left.id);
    const rightOrder = incomingOrder.get(right.id);
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return (
      serverElements.findIndex((item) => item.id === left.id) -
      serverElements.findIndex((item) => item.id === right.id)
    );
  });
}

function mergeSlide(serverSlide: PitchSlide, incomingSlide: PitchSlide): PitchSlide {
  const incomingWins =
    incomingSlide.version > serverSlide.version ||
    (incomingSlide.version === serverSlide.version &&
      incomingSlide.updatedAt >= serverSlide.updatedAt);
  const winner = incomingWins ? incomingSlide : serverSlide;
  return {
    ...winner,
    version: Math.max(serverSlide.version, incomingSlide.version),
    updatedAt: Math.max(serverSlide.updatedAt, incomingSlide.updatedAt),
    deletedAt:
      serverSlide.deletedAt || incomingSlide.deletedAt
        ? Math.max(serverSlide.deletedAt ?? 0, incomingSlide.deletedAt ?? 0)
        : undefined,
    elements: mergeElements(serverSlide.elements, incomingSlide.elements),
    assetIds: { ...serverSlide.assetIds, ...incomingSlide.assetIds },
    durationMs: incomingWins ? incomingSlide.durationMs : serverSlide.durationMs,
    audioCues: incomingWins ? incomingSlide.audioCues : serverSlide.audioCues,
    inkLayers: incomingWins ? incomingSlide.inkLayers : serverSlide.inkLayers,
  };
}

/**
 * Consolidate edits made from two devices. Incoming slide order is intentional;
 * server-only slides are appended so a stale client cannot silently erase them.
 */
export function mergePitchDocuments(
  serverDocument: PitchDocument,
  incomingDocument: PitchDocument,
): PitchDocument {
  const serverById = new Map(serverDocument.slides.map((slide) => [slide.id, slide]));
  const merged = incomingDocument.slides.map((slide) => {
    const serverSlide = serverById.get(slide.id);
    serverById.delete(slide.id);
    return serverSlide ? mergeSlide(serverSlide, slide) : slide;
  });
  for (const serverOnly of serverDocument.slides) {
    if (serverById.has(serverOnly.id)) merged.push(serverOnly);
  }
  return { schemaVersion: 1, slides: merged };
}
