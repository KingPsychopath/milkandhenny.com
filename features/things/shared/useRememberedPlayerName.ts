import { useCallback, useEffect, useState } from "react";
import { gameBrowserKey } from "./multiplayer-keys";

const PLAYER_NAME_KEY = gameBrowserKey("multiplayer", 1, "player-name");
const SHARED_MAX_NAME_LENGTH = 32;

function readStoredName(maxLength: number) {
  try {
    const value = localStorage.getItem(PLAYER_NAME_KEY)?.trim() ?? "";
    return value.length > 0 && value.length <= maxLength ? value : "";
  } catch {
    return "";
  }
}

function saveStoredName(value: string) {
  const name = value.trim();
  if (!name || name.length > SHARED_MAX_NAME_LENGTH) return;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch {
    // Storage is a convenience. Joining still works when it is unavailable.
  }
}

/**
 * Remembers the last successful multiplayer display name on this device.
 *
 * The room remains the source of truth for the current player. This value only removes repeated
 * typing when the same person opens another room, and every caller keeps the field editable.
 */
export function useRememberedPlayerName(maxLength = SHARED_MAX_NAME_LENGTH) {
  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setName(readStoredName(maxLength));
    setLoaded(true);
  }, [maxLength]);

  const remember = useCallback((value: string) => {
    saveStoredName(value);
  }, []);

  return { loaded, name, setName, remember };
}
