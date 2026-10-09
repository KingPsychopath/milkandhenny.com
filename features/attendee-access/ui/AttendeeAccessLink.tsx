import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export function AttendeeAccessLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const [pulled, setPulled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnPath = useRef("/");
  useEffect(() => {
    setPulled(false);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [pathname]);
  const hiddenSurface = pathname.startsWith("/admin") || pathname.startsWith("/things/");
  if (hiddenSurface) return null;
  const photo = pathname.split("/").filter(Boolean).length === 3 && pathname.startsWith("/pics/");
  const accountOpen = pathname === "/my" || pathname.startsWith("/access");
  const destination = accountOpen ? returnPath.current : "/my";
  const cord = accountOpen ? 20 : (pathname === "/" ? 40 : 44) + 20;
  return (
    <Link
      to={destination}
      aria-label={accountOpen ? "back to site" : "account"}
      title={accountOpen ? "Back to site" : "Account"}
      className={`lamp-toggle account-pull ${photo ? "account-pull--photo" : ""}`}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (timer.current) return;
        if (!accountOpen) returnPath.current = pathname;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        setPulled(true);
        timer.current = setTimeout(
          () => {
            timer.current = null;
            setPulled(false);
            void navigate({
              to: destination,
              viewTransition: reduced ? false : { types: ["account-pull"] },
            });
          },
          reduced ? 0 : 180,
        );
      }}
    >
      <span className="lamp-cord" style={{ height: cord + (pulled ? 16 : 0) }} />
      <span className="lamp-bulb account-pull-handle" aria-hidden="true">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            d="M9.5 3h5l.5 3 2.1 1.2 2.8-1.1 2.5 4.3-2.3 1.9v2.4l2.3 1.9-2.5 4.3-2.8-1.1-2.1 1.2-.5 3h-5l-.5-3-2.1-1.2-2.8 1.1-2.5-4.3 2.3-1.9v-2.4l-2.3-1.9 2.5-4.3 2.8 1.1L9 6z"
            transform="translate(0 -1.5) scale(1 .92)"
          />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
    </Link>
  );
}
