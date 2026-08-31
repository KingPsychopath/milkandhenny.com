import { useEffect, useState } from "react";

export const SAFE_GAME_NAVIGATION_EVENT = "mah-safe-game-navigation";

/** Whether global shortcuts may safely sit above the current game screen. */
export function useGameNavigationSafety(): boolean {
  const [safe, setSafe] = useState(false);

  useEffect(() => {
    const update = (event?: Event) => {
      const next =
        event instanceof CustomEvent && typeof event.detail?.safe === "boolean"
          ? event.detail.safe
          : document.documentElement.dataset.gameSafeNavigation === "true";
      setSafe(next);
    };
    update();
    window.addEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
    return () => window.removeEventListener(SAFE_GAME_NAVIGATION_EVENT, update);
  }, []);

  return safe;
}

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
