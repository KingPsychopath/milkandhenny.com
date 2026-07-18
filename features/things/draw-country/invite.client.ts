import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseDrawCountryPlayerFragment } from "./draw-country-invite";
import { drawCountryBrowserKeys } from "./draw-country-keys";

export function captureDrawCountryInvite(roomId: string) {
  const fragmentToken = parseDrawCountryPlayerFragment(consumeLocationFragment());
  const token = fragmentToken || sessionStorage.getItem(drawCountryBrowserKeys.invite(roomId));
  if (token) sessionStorage.setItem(drawCountryBrowserKeys.invite(roomId), token);
  return token ?? undefined;
}
