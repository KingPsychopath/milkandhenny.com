import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseTwinPlayerFragment } from "./twin-invite";
import { twinBrowserKeys } from "./twin-keys";
import { readStorageValue, writeStorageValue } from "../shared/game-storage.client";

export function captureTwinInvite(roomId: string) {
  const fragmentToken = parseTwinPlayerFragment(consumeLocationFragment());
  const key = twinBrowserKeys.invite(roomId);
  const token = fragmentToken || readStorageValue(sessionStorage, key);
  if (token) writeStorageValue(sessionStorage, key, token);
  return token ?? undefined;
}
