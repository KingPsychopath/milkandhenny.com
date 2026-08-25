import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" || pathname === "/access" || pathname.startsWith("/admin");
  const [safeGameScreen, setSafeGameScreen] = useState(false);
  const [nearTop, setNearTop] = useState(true);
  const scrollFrame = useRef<number | null>(null);

  useEffect(() => {
    if (hiddenSurface) return;
    const update = (event?: Event) => {
      const safe =
        event instanceof CustomEvent && typeof event.detail?.safe === "boolean"
          ? event.detail.safe
          : document.documentElement.dataset.gameSafeNavigation === "true";
      setSafeGameScreen(safe);
    };
    update();
    window.addEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
    return () => window.removeEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
  }, [hiddenSurface, pathname]);

  useEffect(() => {
    if (hiddenSurface) return;
    const update = () => {
      if (scrollFrame.current !== null) return;
      scrollFrame.current = requestAnimationFrame(() => {
        setNearTop(window.scrollY < 80);
        scrollFrame.current = null;
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    };
  }, [hiddenSurface, pathname]);

  if (hiddenSurface) return null;
  if (pathname.startsWith("/things/") && !safeGameScreen) return null;
  return (
    <a
      href="/my"
      style={{ opacity: nearTop ? 1 : 0, pointerEvents: nearTop ? "auto" : "none" }}
      className="mh-action mh-action--quiet fixed left-4 top-2 z-30 theme-muted sm:left-auto sm:right-20"
    >
      account
    </a>
  );
}
