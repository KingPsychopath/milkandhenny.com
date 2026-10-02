import { Link, useRouterState } from "@tanstack/react-router";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hiddenSurface =
    pathname === "/my" ||
    pathname.startsWith("/access") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/things/");

  if (hiddenSurface) return null;
  const className = "mh-action mh-action--quiet fixed right-20 top-2 z-30 theme-muted";
  return (
    <Link to="/my" className={className}>
      account
    </Link>
  );
}
