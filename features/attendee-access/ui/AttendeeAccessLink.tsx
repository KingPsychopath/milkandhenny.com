import { useEffect, useRef, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { SAFE_GAME_NAVIGATION_EVENT } from "@/features/things/shared/useSafeGameNavigation";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" || pathname === "/access" || pathname.startsWith("/admin");
  const [safeGameScreen, setSafeGameScreen] = useState(false);
  const [nearTop, setNearTop] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const scrollFrame = useRef<number | null>(null);

  useEffect(() => {
    if (hiddenSurface) {
      setAuthenticated(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/attendee/session?view=status", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Account status unavailable");
        return (await response.json()) as { authenticated?: boolean };
      })
      .then((body) => {
        if (!cancelled) setAuthenticated(body.authenticated === true);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hiddenSurface]);

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
  const style = {
    opacity: nearTop && authenticated !== null ? 1 : 0,
    pointerEvents: nearTop && authenticated !== null ? ("auto" as const) : ("none" as const),
  };
  const className =
    "mh-action mh-action--quiet fixed left-4 top-2 z-30 theme-muted sm:left-auto sm:right-20";
  return authenticated ? (
    <Link to="/my" style={style} className={className}>
      account
    </Link>
  ) : (
    <Link to="/access" search={{ returnTo: "/my" }} style={style} className={className}>
      account
    </Link>
  );
}
