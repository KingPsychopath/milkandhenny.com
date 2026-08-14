import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseLiarsPlayerFragment } from "./liars-invite";
import { liarsBrowserKeys } from "./liars-keys";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { MULTIPLAYER_ROOM_TTL_SECONDS } from "../shared/multiplayer";

export function captureLiarsInvite(roomId: string) {
  const fragmentToken = parseLiarsPlayerFragment(consumeLocationFragment());
  const token =
    fragmentToken || readExpiringLocalValue<string>(liarsBrowserKeys.invite(roomId)) || "";
  // Kept in localStorage rather than session: closing the tab to change wifi, or Safari deciding
  // to reap it, should not cost the host their QR code.
  if (token)
    writeExpiringLocalValue(
      liarsBrowserKeys.invite(roomId),
      token,
      Date.now() + MULTIPLAYER_ROOM_TTL_SECONDS * 1_000,
    );
  return token || undefined;
}
