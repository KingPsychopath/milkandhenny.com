import { useLayoutEffect, type RefObject } from "react";

import { createPitchNightScrollMotion } from "./pitch-night-scroll.client";
import { createPitchNightWorld } from "./pitch-night-world.client";

const COMPACT_QUERY = "(max-width: 767px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const JOURNEY_SCENE_QUERY = ":scope > section, :scope > [data-breath]";
const JOURNEY_POSITION_KEY = "pitch-night:journey-position";

interface JourneyAnchor {
  element: HTMLElement;
  progress: number;
}

interface StoredJourneyPosition {
  progress: number;
  sceneIndex: number;
}

function getNavigationType() {
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return navigation?.type;
}

function scrollWithoutAnimation(top: number) {
  const documentElement = document.documentElement;
  const previousScrollBehavior = documentElement.style.scrollBehavior;
  documentElement.style.scrollBehavior = "auto";
  window.scrollTo(0, top);
  documentElement.style.scrollBehavior = previousScrollBehavior;
}

function captureJourneyAnchor(root: HTMLElement): JourneyAnchor | null {
  const viewportAnchor = innerHeight * 0.5;
  let closest: { distance: number; element: HTMLElement; progress: number } | null = null;

  for (const element of root.querySelectorAll<HTMLElement>(JOURNEY_SCENE_QUERY)) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;

    const distance =
      viewportAnchor < rect.top
        ? rect.top - viewportAnchor
        : viewportAnchor > rect.bottom
          ? viewportAnchor - rect.bottom
          : 0;
    if (closest && closest.distance <= distance) continue;

    closest = {
      distance,
      element,
      progress: Math.max(0, Math.min(1, (viewportAnchor - rect.top) / rect.height)),
    };
  }

  return closest ? { element: closest.element, progress: closest.progress } : null;
}

function readJourneyAnchor(root: HTMLElement): JourneyAnchor | null {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(JOURNEY_POSITION_KEY) ?? "null",
    ) as StoredJourneyPosition | null;
    if (!stored || !Number.isInteger(stored.sceneIndex) || !Number.isFinite(stored.progress)) {
      return null;
    }

    const element = root.querySelectorAll<HTMLElement>(JOURNEY_SCENE_QUERY)[stored.sceneIndex];
    if (!element) return null;
    return { element, progress: Math.max(0, Math.min(1, stored.progress)) };
  } catch {
    return null;
  }
}

function storeJourneyAnchor(root: HTMLElement, anchor: JourneyAnchor | null) {
  if (!anchor) return;
  const scenes = [...root.querySelectorAll<HTMLElement>(JOURNEY_SCENE_QUERY)];
  const sceneIndex = scenes.indexOf(anchor.element);
  if (sceneIndex < 0) return;

  try {
    sessionStorage.setItem(
      JOURNEY_POSITION_KEY,
      JSON.stringify({ sceneIndex, progress: anchor.progress } satisfies StoredJourneyPosition),
    );
  } catch {
    // Scroll restoration remains best-effort when storage is unavailable.
  }
}

function restoreJourneyAnchor(anchor: JourneyAnchor) {
  if (!anchor.element.isConnected) return;
  const rect = anchor.element.getBoundingClientRect();
  const nextScroll =
    scrollY + rect.top + rect.height * anchor.progress - Math.max(innerHeight, 1) * 0.5;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  scrollWithoutAnimation(Math.max(0, Math.min(maxScroll, nextScroll)));
}

function manageScrollRestoration() {
  const previousScrollRestoration = history.scrollRestoration;
  history.scrollRestoration = "manual";

  return () => {
    history.scrollRestoration = previousScrollRestoration;
  };
}

export function usePitchNightMotion(
  rootRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const navigationType = getNavigationType();
    const cleanScrollRestoration = manageScrollRestoration();
    const compactMedia = matchMedia(COMPACT_QUERY);
    const reducedMotionMedia = matchMedia(REDUCED_MOTION_QUERY);
    let cancelled = false;
    let buildVersion = 0;
    let rebuildFrame = 0;
    let settleFrame = 0;
    let secondSettleFrame = 0;
    let anchorFrame = 0;
    let resizeTimer = 0;
    let stableViewportWidth = innerWidth;
    let stableViewportHeight = innerHeight;
    let activeCompact = compactMedia.matches;
    let latestAnchor =
      navigationType === "back_forward"
        ? (readJourneyAnchor(root) ?? captureJourneyAnchor(root))
        : captureJourneyAnchor(root);
    let modules:
      | {
          ScrollTrigger: (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];
          THREE: typeof import("three");
          gsap: (typeof import("gsap"))["gsap"];
        }
      | undefined;
    let disposeSession = () => {};

    const updateAnchor = () => {
      anchorFrame = 0;
      if (innerWidth !== stableViewportWidth || innerHeight !== stableViewportHeight) {
        return;
      }
      latestAnchor = captureJourneyAnchor(root) ?? latestAnchor;
    };
    const handleScroll = () => {
      if (anchorFrame) return;
      anchorFrame = requestAnimationFrame(updateAnchor);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    const cancelSettling = () => {
      cancelAnimationFrame(settleFrame);
      cancelAnimationFrame(secondSettleFrame);
      settleFrame = 0;
      secondSettleFrame = 0;
    };

    const buildSession = (anchor: JourneyAnchor | null) => {
      if (!modules || cancelled) return;

      const version = ++buildVersion;
      cancelSettling();
      disposeSession();
      disposeSession = () => {};
      root.removeAttribute("data-finale-active");
      const compact = compactMedia.matches;
      activeCompact = compact;
      if (reducedMotionMedia.matches) return;

      const world = createPitchNightWorld(modules.THREE, canvas, compact);
      const cleanScroll = createPitchNightScrollMotion({
        gsap: modules.gsap,
        ScrollTrigger: modules.ScrollTrigger,
        root,
        world,
        compact,
      });
      disposeSession = () => {
        cleanScroll();
        world.dispose();
      };

      settleFrame = requestAnimationFrame(() => {
        secondSettleFrame = requestAnimationFrame(() => {
          if (cancelled || version !== buildVersion) return;
          modules?.ScrollTrigger.refresh();
          if (anchor) restoreJourneyAnchor(anchor);
          modules?.ScrollTrigger.update();
          stableViewportWidth = innerWidth;
          stableViewportHeight = innerHeight;
          latestAnchor = captureJourneyAnchor(root) ?? anchor;
        });
      });
    };

    const scheduleRebuild = () => {
      const anchor = latestAnchor;
      cancelAnimationFrame(rebuildFrame);
      rebuildFrame = requestAnimationFrame(() => {
        rebuildFrame = 0;
        buildSession(anchor);
      });
    };

    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (
          cancelled ||
          !modules ||
          reducedMotionMedia.matches ||
          activeCompact !== compactMedia.matches
        ) {
          return;
        }

        modules.ScrollTrigger.refresh();
        if (latestAnchor) restoreJourneyAnchor(latestAnchor);
        modules.ScrollTrigger.update();
        stableViewportWidth = innerWidth;
        stableViewportHeight = innerHeight;
        latestAnchor = captureJourneyAnchor(root) ?? latestAnchor;
      }, 240);
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) scheduleRebuild();
    };
    const handlePageHide = () => {
      storeJourneyAnchor(root, latestAnchor ?? captureJourneyAnchor(root));
    };
    compactMedia.addEventListener("change", scheduleRebuild);
    reducedMotionMedia.addEventListener("change", scheduleRebuild);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("resize", handleResize);

    void (async () => {
      try {
        const [THREE, gsapModule, scrollModule] = await Promise.all([
          import("three"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (cancelled) return;

        const gsap = gsapModule.gsap;
        const ScrollTrigger = scrollModule.ScrollTrigger;
        gsap.registerPlugin(ScrollTrigger);
        modules = { THREE, gsap, ScrollTrigger };
        buildSession(navigationType === "back_forward" ? latestAnchor : null);
      } catch {
        // The entire story remains readable when WebGL or motion is unavailable.
      }
    })();

    return () => {
      cancelled = true;
      buildVersion += 1;
      cancelAnimationFrame(rebuildFrame);
      cancelAnimationFrame(anchorFrame);
      window.clearTimeout(resizeTimer);
      cancelSettling();
      compactMedia.removeEventListener("change", scheduleRebuild);
      reducedMotionMedia.removeEventListener("change", scheduleRebuild);
      handlePageHide();
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll);
      cleanScrollRestoration();
      disposeSession();
    };
  }, [canvasRef, rootRef]);
}
