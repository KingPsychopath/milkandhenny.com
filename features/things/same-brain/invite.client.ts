import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseSameBrainPlayerFragment } from "./same-brain-invite";
import { sameBrainBrowserKeys } from "./same-brain-keys";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { MULTIPLAYER_ROOM_TTL_SECONDS } from "../shared/multiplayer";

export function captureSameBrainInvite(roomId: string) {
  const fragmentToken = parseSameBrainPlayerFragment(consumeLocationFragment());
  const token =
    fragmentToken || readExpiringLocalValue<string>(sameBrainBrowserKeys.invite(roomId)) || "";
  // localStorage rather than session: closing the tab to change wifi should not cost the host their
  // QR code.
  if (token)
    writeExpiringLocalValue(
      sameBrainBrowserKeys.invite(roomId),
      token,
      Date.now() + MULTIPLAYER_ROOM_TTL_SECONDS * 1_000,
    );
  return token || undefined;
}
