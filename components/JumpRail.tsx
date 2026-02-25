"use client";

import { useCallback, useRef, useState } from "react";
import { useOutsideClick } from "@/hooks/useOutsideClick";

export type JumpRailItem = { id: string; label: string };

type JumpRailProps = {
  /** Sections to jump to (id = element id, label = shown in rail). */
  items: JumpRailItem[];
  /** Accessible name for the control. */
  ariaLabel?: string;
};

/** Max visible label chars before truncating with "…" */
const LABEL_CAP = 18;

const SWIPE_THRESHOLD = 40;

/**
 * Edge placement: use safe-area only so rail is flush to edge by default;
 * inset only appears on notched devices where the gap is expected.
 * Jump rail: 20–24px visible strip, minimum 48px wide touch region.
 */
const VISIBLE_STRIP_WIDTH_PX = 20;
const MIN_TOUCH_SIZE_PX = 56;

/**
 * Floating vertical bookmark rail: collapsed tab on the right edge,
 * expands on hover/tap or swipe. Tap outside (or mouse leave) closes when open.
 */
export function JumpRail({ items, ariaLabel }: JumpRailProps) {
  const [open, setOpen] = useState(false);
  const touchStartX = useRef(0);
  const didSwipe = useRef(false);
  const navRef = useRef<HTMLElement>(null);

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  }, []);

  useOutsideClick(navRef, () => setOpen(false), open);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    didSwipe.current = false;
    touchStartX.current = e.targetTouches[0].clientX;
  }, []);

  /** Swipe left on tab → open. Swipe right on panel → close. */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent, onPanel: boolean) => {
      const endX = e.changedTouches[0].clientX;
      const delta = touchStartX.current - endX;
      if (onPanel) {
        if (delta < -SWIPE_THRESHOLD) {
          didSwipe.current = true;
          setOpen(false);
        }
      } else {
        if (delta > SWIPE_THRESHOLD) {
          didSwipe.current = true;
          setOpen(true);
        }
      }
    },
    []
  );

  const handleTabClick = useCallback(() => {
    if (didSwipe.current) return;
    setOpen((o) => !o);
  }, []);

  if (items.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="fixed top-1/2 -translate-y-1/2 z-10 flex flex-row-reverse items-stretch"
      style={{
        right: "env(safe-area-inset-right, 0)",
        maxHeight: "min(80vh, 480px)",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      aria-label={ariaLabel ?? "Jump to section"}
    >
      {/* Expandable panel — swipe left on panel to close */}
      <div
        className={`flex flex-col overflow-hidden transition-[max-width,opacity] duration-300 ease-out border-l rounded-l-md touch-pan-y ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{
          maxWidth: open ? 180 : 0,
          opacity: open ? 1 : 0,
          borderColor: "var(--stone-200)",
          background: "var(--background)",
          boxShadow: open ? "-4px 0 12px oklch(0 0 0 / 0.06)" : "none",
        }}
        aria-hidden={!open}
        onTouchStart={open ? handleTouchStart : undefined}
        onTouchEnd={open ? (e) => handleTouchEnd(e, true) : undefined}
      >
        <div className="flex flex-col py-2 gap-px overflow-y-auto" style={{ minWidth: 140 }}>
          {items.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => jump(id)}
              className="font-mono text-[11px] leading-tight h-auto py-1.5 px-3 text-left rounded-md transition-colors hover:bg-stone-200/80 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-inset whitespace-nowrap overflow-hidden text-ellipsis min-h-[44px] flex items-center"
              style={{ color: "var(--foreground)" }}
              title={label}
            >
              {label.length > LABEL_CAP ? `${label.slice(0, LABEL_CAP)}…` : label}
            </button>
          ))}
        </div>
      </div>

      {/* Bookmark tab: min 48px touch region, 20px visible strip (padding extends hit area) */}
      <button
        type="button"
        onClick={handleTabClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={(e) => handleTouchEnd(e, false)}
        className="flex items-center justify-end shrink-0 py-0 pr-0 md:pr-0 transition-[width] duration-300 md:hover:w-6 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-inset focus:ring-offset-0 md:!min-w-0 md:!min-h-0"
        style={{
          minWidth: MIN_TOUCH_SIZE_PX,
          minHeight: MIN_TOUCH_SIZE_PX,
        }}
        aria-label={ariaLabel ?? "Jump to section"}
        aria-expanded={open}
      >
        <span
          className="flex items-center justify-center h-12 md:h-14 rounded-l-md flex-shrink-0"
          style={{
            width: VISIBLE_STRIP_WIDTH_PX,
            background: "var(--stone-100)",
            borderWidth: "1px 0 1px 1px",
            borderColor: "var(--stone-300)",
            color: "var(--stone-600)",
            boxShadow: "-2px 0 8px oklch(0 0 0 / 0.04)",
          }}
          aria-hidden
        >
          <span className="font-mono text-[10px] opacity-70">&#8250;</span>
        </span>
      </button>
    </nav>
  );
}
