import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { centreBrowserKeys } from "./centre-keys";
import { parseCentrePlayerFragment } from "./centre-invite";

export function captureCentreInvite(roomId: string) {
  const fragmentToken = parseCentrePlayerFragment(consumeLocationFragment());
  const token = fragmentToken || sessionStorage.getItem(centreBrowserKeys.invite(roomId));
  if (token) sessionStorage.setItem(centreBrowserKeys.invite(roomId), token);
  return token ?? undefined;
}
