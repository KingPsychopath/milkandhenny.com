import { useEffect, useRef } from "react";

/**
 * Calls `onEscape` when the Escape key is pressed.
 * Only active when `enabled` is true. Callback is ref-stable
 * so the listener doesn't re-subscribe on every render.
 *
 * @param onEscape - Called when Escape is pressed.
 * @param enabled - When false, no listener is attached.
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;

    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") onEscapeRef.current();
    }

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
}
