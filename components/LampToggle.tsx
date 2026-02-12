"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";

/** Routes where the lamp should be fully hidden (own dark styling) */
const HIDDEN_ROUTES = ["/party", "/icebreaker", "/best-dressed", "/guestlist"] as const;

/** Check if we're on a single photo page: /pics/{album}/{photo} */
function isSinglePhotoPage(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  return segments.length === 3 && segments[0] === "pics";
}

/** How far (px) the user must scroll before the lamp hides */
const SCROLL_THRESHOLD = 80;

/** Cord heights — slightly longer on inner pages */
const CORD_REST = { home: 40, inner: 44 } as const;
const CORD_PULL_EXTRA = 16;

/** How long the bulb stays fully opaque after a tap (ms) */
const TAP_LINGER_MS = 600;

/** Delay before auto-activating dark mode on photo pages (ms) */
const AUTO_DARK_DELAY = 400;

/**
 * A pull-cord lamp toggle in the corner of the screen.
 * Click to pull the cord and shift between sunlight and moonlight.
 *
 * On single photo pages the lamp moves to the top-right corner and
 * auto-activates dark mode with a pull animation for a cinematic feel.
 * The user's original preference is restored when they navigate away.
 */
export function LampToggle() {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [pulled, setPulled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tapped, setTapped] = useState(false);
  const lastScrollY = useRef(0);
  const ticking = useRef(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Track whether dark mode was forced by the photo page */
  const autoForced = useRef(false);
  /** The user's real saved preference before we overrode it */
  const savedPref = useRef<string | null>(null);

  const hidden = HIDDEN_ROUTES.some((r) => pathname.startsWith(r));
  const isPhotoPage = isSinglePhotoPage(pathname);
  const isHome = pathname === "/";
  const cordRest = isHome ? CORD_REST.home : CORD_REST.inner;

  /** Hydrate from localStorage */
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") {
      setDark(true);
      document.documentElement.setAttribute("data-theme", "dark");
    }
    setMounted(true);
  }, []);

  /**
   * Auto-activate dark mode on photo pages.
   * Shows the pull animation, then switches to dark.
   * On leave, restores the user's original preference.
   */
  useEffect(() => {
    if (!mounted) return;

    if (isPhotoPage && !dark) {
      /* Save their current preference so we can restore it */
      savedPref.current = localStorage.getItem("theme") ?? "light";
      autoForced.current = true;

      /* Animate the pull after a beat so the page settles first */
      const timer = setTimeout(() => {
        setPulled(true);
        setTimeout(() => setPulled(false), 300);

        setDark(true);
        document.documentElement.setAttribute("data-theme", "dark");
        /* Don't write to localStorage — this is temporary */
      }, AUTO_DARK_DELAY);

      return () => clearTimeout(timer);
    }

    /* Restore when navigating away from the photo page */
    if (!isPhotoPage && autoForced.current) {
      autoForced.current = false;
      const original = savedPref.current ?? "light";
      const shouldBeDark = original === "dark";
      setDark(shouldBeDark);
      document.documentElement.setAttribute(
        "data-theme",
        shouldBeDark ? "dark" : "light"
      );
      savedPref.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhotoPage, mounted]);

  /** Hide lamp when scrolling down past threshold, show when near top */
  useEffect(() => {
    function onScroll() {
      if (ticking.current) return;
      ticking.current = true;

      requestAnimationFrame(() => {
        const y = window.scrollY;

        if (y < SCROLL_THRESHOLD) {
          setVisible(true);
        } else if (y > lastScrollY.current) {
          setVisible(false);
        } else {
          setVisible(true);
        }

        lastScrollY.current = y;
        ticking.current = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggle = useCallback(() => {
    setPulled(true);
    setTimeout(() => setPulled(false), 300);

    setTapped(true);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapped(false), TAP_LINGER_MS);

    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute(
      "data-theme",
      next ? "dark" : "light"
    );

    /* If user manually toggles on the photo page, respect that as their real pref */
    if (isPhotoPage) {
      autoForced.current = false;
    }

    localStorage.setItem("theme", next ? "dark" : "light");
  }, [dark, isPhotoPage]);

  if (!mounted || hidden) return null;

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`lamp-toggle group ${isPhotoPage ? "lamp-toggle--photo" : ""}`}
      style={{
        transform: visible ? "translateY(0)" : "translateY(-90px)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Cord */}
      <div
        className="lamp-cord"
        style={{ height: pulled ? cordRest + CORD_PULL_EXTRA : cordRest }}
      />

      {/* Bulb / pull handle */}
      <div
        className="lamp-bulb"
        style={{ opacity: tapped ? 1 : undefined }}
      >
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
