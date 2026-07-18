import { drawCountryBrowserKeys } from "./draw-country-keys";

export function captureDrawCountryInvite(roomId: string) {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const token =
    parameters.get("join") ?? sessionStorage.getItem(drawCountryBrowserKeys.invite(roomId));
  if (token) sessionStorage.setItem(drawCountryBrowserKeys.invite(roomId), token);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  return token ?? undefined;
}
