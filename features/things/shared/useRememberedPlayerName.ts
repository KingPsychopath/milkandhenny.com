import { useCallback } from "react";

import { useBrowserProfileForm } from "@/lib/client/browser-profile";

const SHARED_MAX_NAME_LENGTH = 32;

/**
 * Remembers the last successful multiplayer display name on this device.
 *
 * The room remains the source of truth for the current player. This value only removes repeated
 * typing when the same person opens another room, and every caller keeps the field editable.
 */
export function useRememberedPlayerName(maxLength = SHARED_MAX_NAME_LENGTH) {
  const {
    loaded,
    name,
    setName,
    remember: rememberProfile,
  } = useBrowserProfileForm({
    maxNameLength: maxLength,
  });

  const remember = useCallback(
    (value: string) => rememberProfile({ name: value }),
    [rememberProfile],
  );

  return { loaded, name, setName, remember };
}
