import { useCallback, useEffect, useRef } from "react";

import { useBrowserGameNameForm } from "@/lib/client/browser-profile";
import { guestNameFromSeed } from "./guest-name";

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
  const guestName = useRef<string | null>(null);

  useEffect(() => {
    if (!loaded || edited.current || (name && !/^guest [a-f0-9]{4}$/i.test(name))) return;
    guestName.current ??= guestNameFromSeed(crypto.randomUUID());
    setName(guestName.current.slice(0, maxLength));
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
