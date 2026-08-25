import { useCallback, useEffect, useRef } from "react";

import { gameNameDefault, useBrowserGameNameForm } from "@/lib/client/browser-profile";

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
  } = useBrowserGameNameForm({
    maxNameLength: maxLength,
  });
  const edited = useRef(false);

  useEffect(() => {
    if (!loaded || name || edited.current) return;
    let active = true;
    void fetch("/api/attendee/session?view=name", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { preferredName?: string | null };
        return body.preferredName?.trim() || null;
      })
      .then((preferredName) => {
        if (!active || edited.current || !preferredName) return;
        setName(gameNameDefault(preferredName, maxLength));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loaded, maxLength, name, setName]);

  const editName = useCallback(
    (value: string) => {
      edited.current = true;
      setName(value);
    },
    [setName],
  );

  const remember = useCallback((value: string) => rememberProfile(value), [rememberProfile]);

  return { loaded, name, setName: editName, remember };
}
