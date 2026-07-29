import { convertToExcalidrawElements, getNonDeletedElements } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";

import { PITCH_SLIDE_STAGE } from "../types";

function frameId(slideId: string): string {
  return `pitch_stage_${slideId}`;
}

export interface PitchStageScene {
  elements: readonly ExcalidrawElement[];
  frame: ExcalidrawFrameElement;
}

/**
 * Excalidraw may pan forever, but a pitch slide has one fixed 16:9 stage.
 * The frame is adapter chrome: it is injected for editing/export and never
 * becomes part of the portable pitch document.
 */
export function toPitchStageScene(
  slideId: string,
  elements: readonly ExcalidrawElement[],
): PitchStageScene {
  const id = frameId(slideId);
  const content = elements
    .filter((element) => element.id !== id)
    .map((element) => ({ ...element, frameId: id }));
  const [created] = convertToExcalidrawElements(
    [
      {
        type: "frame",
        id,
        x: 0,
        y: 0,
        width: PITCH_SLIDE_STAGE.width,
        height: PITCH_SLIDE_STAGE.height,
        children: [],
        name: "what the room sees",
        locked: true,
        customData: { pitchStage: true },
      },
    ],
    { regenerateIds: false },
  );
  if (created.type !== "frame") throw new Error("Pitch stage could not be created");
  return { elements: [created, ...content], frame: created };
}

export function fromPitchStageScene(
  slideId: string,
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] {
  const id = frameId(slideId);
  return elements
    .filter((element) => element.id !== id)
    .map((element) => (element.frameId === id ? { ...element, frameId: null } : element));
}

export function pitchStageExport(
  slideId: string,
  elements: readonly ExcalidrawElement[],
): {
  elements: readonly NonDeleted<ExcalidrawElement>[];
  exportingFrame: ExcalidrawFrameElement;
} {
  const scene = toPitchStageScene(slideId, elements);
  return {
    elements: getNonDeletedElements(scene.elements),
    exportingFrame: scene.frame,
  };
}
