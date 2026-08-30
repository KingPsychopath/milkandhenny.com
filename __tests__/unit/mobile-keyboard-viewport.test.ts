import { describe, expect, it } from "vitest";
import {
  measureMobileKeyboardViewport,
  placeMobileKeyboardViewport,
} from "../../lib/shared/mobile-keyboard-viewport";

describe("mobile keyboard viewport", () => {
  it("detects both panned and resized keyboard viewports", () => {
    const panned = measureMobileKeyboardViewport({
      currentLayoutHeight: 844,
      expandedLayoutHeight: 844,
      scale: 1,
      visualHeight: 420,
      visualTop: 424,
    });
    const resized = measureMobileKeyboardViewport({
      currentLayoutHeight: 844,
      expandedLayoutHeight: 844,
      scale: 1,
      visualHeight: 420,
      visualTop: 0,
    });

    expect(panned.keyboardOpen).toBe(true);
    expect(resized.keyboardOpen).toBe(true);
  });

  it("does not mistake browser chrome or page zoom for the keyboard", () => {
    expect(
      measureMobileKeyboardViewport({
        currentLayoutHeight: 844,
        expandedLayoutHeight: 844,
        scale: 1,
        visualHeight: 760,
        visualTop: 0,
      }).keyboardOpen,
    ).toBe(false);
    expect(
      measureMobileKeyboardViewport({
        currentLayoutHeight: 844,
        expandedLayoutHeight: 844,
        scale: 1.2,
        visualHeight: 420,
        visualTop: 0,
      }).keyboardOpen,
    ).toBe(false);
  });

  it("preserves docks that Safari already anchors to the visual viewport", () => {
    const metrics = measureMobileKeyboardViewport({
      currentLayoutHeight: 844,
      expandedLayoutHeight: 844,
      scale: 1,
      visualHeight: 420,
      visualTop: 424,
    });

    expect(placeMobileKeyboardViewport(metrics, 420)).toEqual({
      bottomOffset: 0,
      topOffset: 0,
    });
  });

  it("corrects docks that remain anchored to the layout viewport", () => {
    const panned = measureMobileKeyboardViewport({
      currentLayoutHeight: 844,
      expandedLayoutHeight: 844,
      scale: 1,
      visualHeight: 420,
      visualTop: 424,
    });
    const resized = { ...panned, visualTop: 0 };

    expect(placeMobileKeyboardViewport(panned, 844)).toEqual({
      bottomOffset: 0,
      topOffset: 424,
    });
    expect(placeMobileKeyboardViewport(resized, 844)).toEqual({
      bottomOffset: 424,
      topOffset: 0,
    });
  });
});
