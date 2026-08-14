import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";

import { PITCH_SLIDE_STAGE } from "../types";

function frameId(slideId: string): string {
  return `pitch_stage_${slideId}`;
}

function stableSeed(value: string): number {
  let seed = 0;
  for (const character of value) seed = (seed * 31 + character.charCodeAt(0)) | 0;
  return Math.max(1, Math.abs(seed));
}

function stageFrame(slideId: string): ExcalidrawFrameElement {
  const id = frameId(slideId);
  const seed = stableSeed(id);
  return {
    id,
    type: "frame",
    x: 0,
    y: 0,
    width: PITCH_SLIDE_STAGE.width,
    height: PITCH_SLIDE_STAGE.height,
    angle: 0 as ExcalidrawFrameElement["angle"],
    strokeColor: "#1b1b1f",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roundness: null,
    roughness: 0,
    opacity: 100,
    seed,
    version: 1,
    versionNonce: seed,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: true,
    name: "what the room sees",
    customData: { pitchStage: true },
  };
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
  const created = stageFrame(slideId);
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
    elements: scene.elements.filter(
      (element): element is NonDeleted<ExcalidrawElement> => !element.isDeleted,
    ),
    exportingFrame: scene.frame,
  };
}
