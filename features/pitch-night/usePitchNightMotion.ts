import { useEffect, type RefObject } from "react";

import { createPitchNightScrollMotion } from "./pitch-night-scroll.client";
import { createPitchNightWorld } from "./pitch-night-world.client";

export function usePitchNightMotion(
  rootRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

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
          world: world.group,
          compact: world.compact,
        });
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
      dispose();
    };
  }, [canvasRef, rootRef]);
}
