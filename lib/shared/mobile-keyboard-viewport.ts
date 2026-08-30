export interface MobileKeyboardViewportSample {
  currentLayoutHeight: number;
  expandedLayoutHeight: number;
  scale: number;
  visualHeight: number;
  visualTop: number;
}

export interface MobileKeyboardViewportMetrics {
  keyboardOpen: boolean;
  layoutHeight: number;
  visualHeight: number;
  visualTop: number;
}

export interface MobileKeyboardViewportPlacement {
  bottomOffset: number;
  topOffset: number;
}

export function measureMobileKeyboardViewport({
  currentLayoutHeight,
  expandedLayoutHeight,
  scale,
  visualHeight,
  visualTop,
}: MobileKeyboardViewportSample): MobileKeyboardViewportMetrics {
  const layoutHeight = Math.max(expandedLayoutHeight, currentLayoutHeight);
  const keyboardDepth = layoutHeight - visualHeight;
  return {
    keyboardOpen: scale < 1.1 && keyboardDepth > Math.max(120, Math.round(layoutHeight * 0.18)),
    layoutHeight,
    visualHeight,
    visualTop: Math.max(0, visualTop),
  };
}

/**
 * Fixed elements use layout-viewport coordinates in some iOS browsers and visual-viewport
 * coordinates in others. Choose the coordinate space that is closest to the dock's unadjusted
 * bottom edge, then apply only the correction that browser still needs.
 */
export function placeMobileKeyboardViewport(
  metrics: MobileKeyboardViewportMetrics,
  dockBottom: number,
): MobileKeyboardViewportPlacement {
  const visualCoordinateBottom = metrics.visualHeight;
  const layoutCoordinateBottom = metrics.visualTop + metrics.visualHeight;
  const usesLayoutCoordinates =
    Math.abs(dockBottom - layoutCoordinateBottom) < Math.abs(dockBottom - visualCoordinateBottom);
  const targetBottom = usesLayoutCoordinates ? layoutCoordinateBottom : visualCoordinateBottom;

  return {
    bottomOffset: Math.max(0, dockBottom - targetBottom),
    topOffset: usesLayoutCoordinates ? metrics.visualTop : 0,
  };
}
