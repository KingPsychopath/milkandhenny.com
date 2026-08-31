import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { centreBrowserKeys } from "./centre-keys";
import { parseCentrePlayerFragment } from "./centre-invite";
import { readStorageValue, writeStorageValue } from "../shared/game-storage.client";

export function captureCentreInvite(roomId: string) {
  const fragmentToken = parseCentrePlayerFragment(consumeLocationFragment());
  const key = centreBrowserKeys.invite(roomId);
  const token = fragmentToken || readStorageValue(sessionStorage, key);
  if (token) writeStorageValue(sessionStorage, key, token);
  return token ?? undefined;
}
