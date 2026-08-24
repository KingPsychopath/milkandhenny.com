import { useEffect, useRef } from "react";

const GAME_SCREEN_STATE_KEY = "__milk_and_henny_game_screen";

function isScreenState(state: unknown, screen: string): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[GAME_SCREEN_STATE_KEY] === screen
  );
}

function withoutScreenState(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const next = { ...(state as Record<string, unknown>) };
  delete next[GAME_SCREEN_STATE_KEY];
  return next;
}

/**
 * Gives a local game round its own browser-history step without serialising live game state into
 * the URL. Back therefore returns to setup before leaving the game, while timers and scores stay
 * in the state/session-storage model that can actually restore them safely.
 */
export function useGameScreenHistory({
  active,
  screen,
  onBack,
}: {
  active: boolean;
  screen: string;
  onBack: () => void;
}) {
  const entryActive = useRef(false);
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (active && !entryActive.current) {
      const currentState = window.history.state;
      const nextState = {
        ...(typeof currentState === "object" && currentState !== null ? currentState : {}),
        [GAME_SCREEN_STATE_KEY]: screen,
      };
      const baseUrl = `${window.location.pathname}${window.location.search}`;
      window.history.pushState(nextState, "", `${baseUrl}#screen=${encodeURIComponent(screen)}`);
      entryActive.current = true;
      return;
    }

    if (!active && entryActive.current) {
      const isCurrentEntry = isScreenState(window.history.state, screen);
      entryActive.current = false;
      if (isCurrentEntry) window.history.back();
    }
  }, [active, screen]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      if (entryActive.current) {
        entryActive.current = false;
        onBackRef.current();
        return;
      }

      // Forward navigation can revisit the marker after Back returned to setup. Do not leave a
      // stale screen fragment in the address bar when the game has not been resumed.
      if (isScreenState(event.state, screen)) {
        window.history.replaceState(
          withoutScreenState(event.state),
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [screen]);
}
