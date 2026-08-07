import { useCallback, useEffect, useState } from "react";
import { partyBrowserKeys } from "./party-keys";

/**
 * Every device in the room speaks the word, so a player on headphones or in another house hears it
 * without relying on the host's speaker. Several phones in one room would otherwise echo a beat
 * apart, so each device keeps its own mute switch.
 */
export function usePartySound() {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(partyBrowserKeys.muted()) === "1");
    } catch {
      // A browser refusing storage just means this device always starts unmuted.
    }
  }, []);

  const toggle = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        localStorage.setItem(partyBrowserKeys.muted(), next ? "1" : "0");
      } catch {
        // Preference is still honoured for this session.
      }
      return next;
    });
  }, []);

  return { muted, toggle };
}
