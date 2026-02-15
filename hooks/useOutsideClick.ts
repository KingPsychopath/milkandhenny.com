import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls `onOutside` when the user clicks or touches outside the given element.
 * Only active when `enabled` is true. Uses capture so the handler runs before
 * the event reaches targets (e.g. links still receive the click after we close).
 *
 * @param ref - Ref to the "inside" element (e.g. modal, dropdown, rail).
 * @param onOutside - Called when mousedown/touchstart happens outside that element.
 * @param enabled - When false, no listeners are attached.
 */
export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onOutside: () => void,
  enabled: boolean
): void {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!enabled) return;

    function handle(e: MouseEvent | TouchEvent) {
      const target = (e.target as Node) ?? null;
      if (!target || ref.current?.contains(target)) return;
      onOutsideRef.current();
    }

    document.addEventListener("mousedown", handle, true);
    document.addEventListener("touchstart", handle, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", handle, true);
      document.removeEventListener("touchstart", handle, true);
    };
  }, [ref, enabled]);
}
