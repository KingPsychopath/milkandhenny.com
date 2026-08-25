import { useEffect } from "react";

export const SAFE_GAME_NAVIGATION_EVENT = "mah-safe-game-navigation";

/** Publishes navigation safety without knowing which optional layers may use it. */
export function useSafeGameNavigation(safe: boolean): void {
  useEffect(() => {
    document.documentElement.dataset.gameSafeNavigation = safe ? "true" : "false";
    window.dispatchEvent(new CustomEvent(SAFE_GAME_NAVIGATION_EVENT, { detail: { safe } }));
    return () => {
      delete document.documentElement.dataset.gameSafeNavigation;
      window.dispatchEvent(
        new CustomEvent(SAFE_GAME_NAVIGATION_EVENT, { detail: { safe: false } }),
      );
    };
  }, [safe]);
}
