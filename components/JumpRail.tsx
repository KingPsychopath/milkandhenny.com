"use client";

import { useCallback, useState } from "react";

export type JumpRailItem = { id: string; label: string };

type JumpRailProps = {
  /** Sections to jump to (id = element id, label = shown in rail). */
  items: JumpRailItem[];
  /** Accessible name for the control. */
  ariaLabel?: string;
};

/** Max visible label chars before truncating with "…" */
const LABEL_CAP = 18;

/**
 * Floating vertical bookmark rail: collapsed tab on the right edge,
 * expands on hover/tap to show section labels you can click to jump to.
 * Thin strip on mobile, wider tab on desktop. Hides when empty.
 */
export function JumpRail({ items, ariaLabel }: JumpRailProps) {
  const [open, setOpen] = useState(false);

  const jump = useCallback((id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  }, []);

  if (items.length === 0) return null;

  return (
    <nav
      className="fixed right-0 top-1/2 -translate-y-1/2 z-10 flex flex-row-reverse items-stretch"
      style={{ maxHeight: "min(80vh, 480px)" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      aria-label={ariaLabel ?? "Jump to section"}
    >
      {/* Expandable panel */}
      <div
        className={`flex flex-col overflow-hidden transition-[max-width,opacity] duration-300 ease-out border-l rounded-l-md ${open ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{
          maxWidth: open ? 180 : 0,
          opacity: open ? 1 : 0,
          borderColor: "var(--stone-200)",
          background: "var(--background)",
          boxShadow: open ? "-4px 0 12px rgba(0,0,0,0.06)" : "none",
        }}
        aria-hidden={!open}
      >
        <div className="flex flex-col py-2 gap-px overflow-y-auto" style={{ minWidth: 140 }}>
          {items.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => jump(id)}
              className="font-mono text-[11px] leading-tight h-auto py-1.5 px-3 text-left rounded-md transition-colors hover:bg-stone-200/80 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-inset whitespace-nowrap overflow-hidden text-ellipsis"
              style={{ color: "var(--foreground)" }}
              title={label}
            >
              {label.length > LABEL_CAP ? `${label.slice(0, LABEL_CAP)}…` : label}
            </button>
          ))}
        </div>
      </div>

      {/* Bookmark tab */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-3 h-12 md:w-5 md:h-14 rounded-l-md transition-all duration-300 md:hover:w-6 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:ring-inset focus:ring-offset-0 shrink-0"
        style={{
          background: "var(--stone-100)",
          borderWidth: "1px 0 1px 1px",
          borderColor: "var(--stone-300)",
          color: "var(--stone-600)",
          boxShadow: "-2px 0 8px rgba(0,0,0,0.04)",
        }}
        aria-label={ariaLabel ?? "Jump to section"}
        aria-expanded={open}
      >
        <span className="font-mono text-[10px] opacity-70" aria-hidden>
          &#8250;
        </span>
      </button>
    </nav>
  );
}
