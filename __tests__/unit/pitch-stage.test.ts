import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (
    skeletons: Array<Record<string, unknown> & { children?: readonly string[] }>,
  ) =>
    skeletons.map((skeleton) => {
      if (skeleton.children?.length) {
        throw new Error("The converter cannot map elements outside this conversion batch");
      }
      return {
        id: "frame",
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        ...skeleton,
      };
    }),
  getNonDeletedElements: (elements: readonly ExcalidrawElement[]) =>
    elements.filter((element) => !element.isDeleted),
}));

import {
  fromPitchStageScene,
  toPitchStageScene,
} from "@/features/things/pitches/ui/pitch-stage.client";

describe("pitch slide stage", () => {
  it("frames existing elements without asking the converter to remap them", () => {
    const rectangle = {
      type: "rectangle",
      id: "object_123",
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      frameId: null,
    } as ExcalidrawElement;

    const scene = toPitchStageScene("slide_123456", [rectangle]);

    expect(scene.elements).toHaveLength(2);
    expect(scene.elements[1]).toMatchObject({
      id: "object_123",
      frameId: scene.frame.id,
    });
    expect(fromPitchStageScene("slide_123456", scene.elements)).toEqual([
      expect.objectContaining({ id: "object_123", frameId: null }),
    ]);
  });
});
