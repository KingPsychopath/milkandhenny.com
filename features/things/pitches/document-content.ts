import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import type { PitchDocument, PitchSlide } from "./types";

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
    return total + pitchSlideContentCount(slide);
  }, 0);
}

export function pitchSlideContentCount(slide: PitchSlide): number {
  if (slide.deletedAt) return 0;
  const elements = slide.elements.filter(isMeaningfulElement).length;
  const media = slide.mediaClips.length;
  const ink = (slide.inkLayers ?? []).filter((layer) => layer.strokes.length > 0).length;
  return elements + media + ink;
}

export function hasPitchDocumentContent(document: PitchDocument): boolean {
  return pitchDocumentContentCount(document) > 0;
}
