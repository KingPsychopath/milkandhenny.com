"use client";

import { useState, useCallback, useRef, type ReactNode } from "react";

type ViewMode = "masonry" | "single";

type MasonryGridProps = {
  children: ReactNode[];
  /** Callback when view mode changes */
  onViewChange?: (mode: ViewMode) => void;
};

/**
 * Pinterest-style masonry grid with toggle to single-column.
 * Uses CSS columns for the masonry layout — lightweight and performant.
 */
export function MasonryGrid({ children, onViewChange }: MasonryGridProps) {
  const [view, setView] = useState<ViewMode>("masonry");
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => {
    const next = view === "masonry" ? "single" : "masonry";
    setView(next);
    onViewChange?.(next);
  }, [view, onViewChange]);

  return (
    <div>
      {/* View toggle */}
      <div className="flex justify-end mb-4">
        <button
          onClick={toggle}
          className="font-mono text-micro theme-muted hover:text-foreground transition-colors tracking-wide"
          aria-label={`Switch to ${view === "masonry" ? "single column" : "grid"} view`}
        >
          {view === "masonry" ? "[ single ]" : "[ grid ]"}
        </button>
      </div>

      {/* Grid */}
      <div ref={containerRef} className={view === "masonry" ? "gallery-masonry" : "gallery-single"}>
        {children}
      </div>
    </div>
  );
}

export type { ViewMode };

