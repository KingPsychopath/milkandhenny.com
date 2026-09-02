import { Link, useRouterState } from "@tanstack/react-router";

import { useGameNavigationSafety } from "@/features/things/shared/useSafeGameNavigation";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" || pathname.startsWith("/access") || pathname.startsWith("/admin");
  const safeGameScreen = useGameNavigationSafety();

  if (hiddenSurface) return null;
  if (pathname.startsWith("/things/") && !safeGameScreen) return null;
  const className = pathname.startsWith("/things/")
    ? "mh-action mh-action--secondary themed-floating-notice themed-floating-notice-muted fixed bottom-3 right-3 z-30 text-xs"
    : "mh-action mh-action--quiet fixed right-20 top-2 z-30 theme-muted";
  return (
    <Link to="/my" className={className}>
      account
    </Link>
  );
}
