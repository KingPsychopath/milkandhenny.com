"use client";

import { useEffect, useRef } from "react";

/**
 * A thin horizontal bar at the top of the viewport that fills
 * as the reader scrolls through the article.
 *
 * Uses a ref + direct DOM mutation instead of useState to avoid
 * triggering React re-renders on every scroll frame.
 */
export function ReadingProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ticking = false;

    function update() {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0 || !barRef.current) return;
      const pct = Math.min((scrollTop / docHeight) * 100, 100);
      barRef.current.style.width = `${pct}%`;
      ticking = false;
    }

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="reading-progress-track" aria-hidden="true">
      <div ref={barRef} className="reading-progress-bar" style={{ width: 0 }} />
    </div>
  );
}
