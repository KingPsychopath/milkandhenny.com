"use client";

import { memo } from "react";

/**
 * Supported toggle shapes. Expand this union as needed.
 * - `"square"` — rounded square (default)
 * - `"circle"` — fully round
 */
const TOGGLE_SHAPES = {
  square: "rounded",
  circle: "rounded-full",
} as const;

type ToggleShape = keyof typeof TOGGLE_SHAPES;

/**
 * Supported sizes. Each maps to Tailwind width/height classes
 * and an appropriate checkmark SVG dimension.
 */
const TOGGLE_SIZES = {
  sm: { box: "w-5 h-5", svg: 10 },
  md: { box: "w-6 h-6", svg: 14 },
} as const;

type ToggleSize = keyof typeof TOGGLE_SIZES;

/**
 * Visual variants control the unselected state colours.
 * - `"overlay"` — semi-transparent dark bg + white border, for use on images
 * - `"surface"` — theme border + muted text, for use on light/dark surfaces
 */
const TOGGLE_VARIANTS = {
  overlay: {
    unselected: "bg-black/30 border-white/40 text-transparent hover:border-white/70 hover:text-white/70",
    border: "border",
  },
  surface: {
    unselected: "theme-border theme-muted hover:text-foreground",
    border: "border",
  },
} as const;

type ToggleVariant = keyof typeof TOGGLE_VARIANTS;

type SelectionToggleProps = {
  selected: boolean;
  onToggle: () => void;
  /** @default "square" */
  shape?: ToggleShape;
  /** @default "sm" */
  size?: ToggleSize;
  /** @default "overlay" */
  variant?: ToggleVariant;
  className?: string;
};

/**
 * Unified selection toggle used across album and transfer galleries.
 *
 * Same visual language everywhere: amber fill when selected, configurable
 * shape/size/variant for different contexts (overlay on images vs surface
 * in file lists). Behaviour (when to show, positioning) is owned by the
 * parent — this component only renders the toggle itself.
 */
export const SelectionToggle = memo(function SelectionToggle({
  selected,
  onToggle,
  shape = "square",
  size = "sm",
  variant = "overlay",
  className = "",
}: SelectionToggleProps) {
  const { box, svg } = TOGGLE_SIZES[size];
  const rounding = TOGGLE_SHAPES[shape];
  const { unselected, border } = TOGGLE_VARIANTS[variant];

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={selected ? "Deselect" : "Select for download"}
      className={`group/toggle flex items-center justify-center ${box} ${rounding} ${border} shrink-0 transition-colors ${
        selected
          ? "bg-amber-500 border-amber-500 text-white"
          : unselected
      } ${className}`}
    >
      <svg
        width={svg}
        height={svg}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={selected ? 3 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={selected ? "" : "opacity-0 group-hover/toggle:opacity-100 transition-opacity"}
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </button>
  );
});
