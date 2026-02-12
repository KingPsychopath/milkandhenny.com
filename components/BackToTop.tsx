"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

/** Routes where the button should be hidden */
const HIDDEN_ROUTES = ["/party", "/icebreaker", "/best-dressed", "/guestlist"] as const;

/** Scroll distance (px) before the button appears */
const SHOW_THRESHOLD = 400;

/**
 * A minimal back-to-top button that fades in once the reader
 * has scrolled past the fold. Matches the lamp's visual language.
 */
export function BackToTop() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const ticking = useRef(false);

  const hidden = HIDDEN_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;

      requestAnimationFrame(() => {
        setShow(window.scrollY > SHOW_THRESHOLD);
        ticking.current = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (hidden) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="back-to-top"
      style={{
        transform: show ? "translateY(0)" : "translateY(20px)",
        opacity: show ? 1 : 0,
        pointerEvents: show ? "auto" : "none",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </button>
  );
}
