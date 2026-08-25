import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" || pathname === "/access" || pathname.startsWith("/admin");
  const [safeGameScreen, setSafeGameScreen] = useState(false);

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

  if (hiddenSurface) return null;
  if (pathname.startsWith("/things/") && !safeGameScreen) return null;
  return (
    <Link
      to="/my"
      className="fixed right-4 top-4 z-30 min-h-11 border theme-border bg-background px-3 py-3 font-mono text-micro shadow-sm hover:opacity-70 sm:right-24 sm:top-3"
    >
      you
    </Link>
  );
}
