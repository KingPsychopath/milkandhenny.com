"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * A pull-cord lamp toggle in the corner of the screen.
 * Click to pull the cord and shift between sunlight and moonlight.
 */
export function LampToggle() {
  const [dark, setDark] = useState(false);
  const [pulled, setPulled] = useState(false);

  /** Hydrate from localStorage */
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") {
      setDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }, []);

  const toggle = useCallback(() => {
    setPulled(true);
    setTimeout(() => setPulled(false), 300);

    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute(
      "data-theme",
      next ? "dark" : "light"
    );
    localStorage.setItem("theme", next ? "dark" : "light");
  }, [dark]);

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="lamp-toggle group"
    >
      {/* Cord */}
      <div
        className="lamp-cord"
        style={{ height: pulled ? 56 : 40 }}
      />

      {/* Bulb / pull handle */}
      <div className="lamp-bulb">
        {dark ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )}
      </div>
    </button>
  );
}
