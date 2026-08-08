import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parseLiarsPlayerFragment } from "./liars-invite";
import { liarsBrowserKeys } from "./liars-keys";

export function captureLiarsInvite(roomId: string) {
  const fragmentToken = parseLiarsPlayerFragment(consumeLocationFragment());
  const token = fragmentToken || sessionStorage.getItem(liarsBrowserKeys.invite(roomId));
  if (token) sessionStorage.setItem(liarsBrowserKeys.invite(roomId), token);
  return token ?? undefined;
}
