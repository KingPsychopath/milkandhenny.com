import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseDrawCountryPlayerFragment } from "./draw-country-invite";
import { drawCountryBrowserKeys } from "./draw-country-keys";
import { readStorageValue, writeStorageValue } from "../shared/game-storage.client";

export function captureDrawCountryInvite(roomId: string) {
  const fragmentToken = parseDrawCountryPlayerFragment(consumeLocationFragment());
  const key = drawCountryBrowserKeys.invite(roomId);
  const token = fragmentToken || readStorageValue(sessionStorage, key);
  if (token) writeStorageValue(sessionStorage, key, token);
  return token ?? undefined;
}
