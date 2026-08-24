import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const NAVIGATION_FEEDBACK_DELAY_MS = 180;

/** Shows feedback only when a route transition takes long enough to be noticed. */
export function NavigationProgress() {
  const routerStatus = useRouterState({ select: (state) => state.status });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (routerStatus !== "pending") {
      setIsVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setIsVisible(true), NAVIGATION_FEEDBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [routerStatus]);

  if (!isVisible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <span className="sr-only" role="status">
        Loading page
      </span>
      <div
        aria-hidden="true"
        className="h-0.5 w-full animate-pulse bg-amber-600 motion-reduce:animate-none"
      />
    </div>
  );
}
