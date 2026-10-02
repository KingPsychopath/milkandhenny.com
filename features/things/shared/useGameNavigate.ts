import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

/** An operation that finishes after its screen closes must not reopen that screen's game. */
export function useGameNavigate(): ReturnType<typeof useNavigate> {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const navigateIfActive: ReturnType<typeof useNavigate> = useCallback(
    (options) =>
      active.current && currentPath.current === pathname ? navigate(options) : Promise.resolve(),
    [navigate, pathname],
  );
  return navigateIfActive;
}
