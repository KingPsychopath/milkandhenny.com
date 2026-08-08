import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseTwinPlayerFragment } from "./twin-invite";
import { twinBrowserKeys } from "./twin-keys";

export function captureTwinInvite(roomId: string) {
  const fragmentToken = parseTwinPlayerFragment(consumeLocationFragment());
  const token = fragmentToken || sessionStorage.getItem(twinBrowserKeys.invite(roomId));
  if (token) sessionStorage.setItem(twinBrowserKeys.invite(roomId), token);
  return token ?? undefined;
}
