import { useCallback, useEffect, useState } from "react";
import { liarsBrowserKeys } from "./liars-keys";

/**
 * Per device, not per room. In a shared room only the elected narrator's phone makes noise anyway;
 * this is the switch for the person who wants their own phone silent regardless.
 */
export function useLiarsSound() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(liarsBrowserKeys.muted()) === "1");
    } catch {
      // A browser refusing storage just means this device always starts unmuted.
    }
  }, []);

  const toggle = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        localStorage.setItem(liarsBrowserKeys.muted(), next ? "1" : "0");
      } catch {
        // Still honoured for this session.
      }
      return next;
    });
  }, []);

  return { muted, toggle };
}
