import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function AttendeeAccessLink({ authenticated }: { authenticated: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" || pathname.startsWith("/access") || pathname.startsWith("/admin");
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
  const className =
    "mh-action mh-action--quiet fixed left-4 top-2 z-30 theme-muted sm:left-auto sm:right-20";
  return authenticated ? (
    <Link to="/my" className={className}>
      account
    </Link>
  ) : (
    <Link to="/access" search={{ returnTo: "/my" }} className={className}>
      account
    </Link>
  );
}
