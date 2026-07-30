import { useLayoutEffect, type RefObject } from "react";

import { createPitchNightScrollMotion } from "./pitch-night-scroll.client";
import { createPitchNightWorld } from "./pitch-night-world.client";

export function usePitchNightMotion(
  rootRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const previousScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const resetJourney = () => window.scrollTo(0, 0);
    resetJourney();
    window.addEventListener("pageshow", resetJourney);
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      resetJourney();
      secondFrame = requestAnimationFrame(resetJourney);
    });
    const cleanJourneyStart = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.removeEventListener("pageshow", resetJourney);
      history.scrollRestoration = previousScrollRestoration;
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return cleanJourneyStart;

    let cancelled = false;
    let dispose = () => {};
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
        const world = createPitchNightWorld(THREE, canvas, () => ScrollTrigger.refresh());
        const cleanScroll = createPitchNightScrollMotion({
          gsap,
          ScrollTrigger,
          root,
          world,
          compact: world.compact,
        });
        ScrollTrigger.refresh();
        ScrollTrigger.update();
        dispose = () => {
          cleanScroll();
          world.dispose();
        };
      } catch {
        // The entire story remains readable when WebGL or motion is unavailable.
      }
    })();

    return () => {
      cancelled = true;
      cleanJourneyStart();
      dispose();
    };
  }, [canvasRef, rootRef]);
}
