import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type { PitchDocument } from "./types";

function isMeaningfulElement(element: ExcalidrawElement): boolean {
  if (element.isDeleted) return false;
  if (element.type === "text") return element.text.trim().length > 0;
  if (element.type === "image") return Boolean(element.fileId);
  if (element.type === "freedraw") {
    return (
      element.points.length > 1 && (Math.abs(element.width) > 0.5 || Math.abs(element.height) > 0.5)
    );
  }
  return true;
}

export function pitchDocumentContentCount(document: PitchDocument): number {
  return document.slides.reduce((total, slide) => {
    if (slide.deletedAt) return total;
    const elements = slide.elements.filter(isMeaningfulElement).length;
    const audio = slide.audioCues.length;
    const ink = (slide.inkLayers ?? []).filter((layer) => layer.strokes.length > 0).length;
    return total + elements + audio + ink;
  }, 0);
}

export function hasPitchDocumentContent(document: PitchDocument): boolean {
  return pitchDocumentContentCount(document) > 0;
}
