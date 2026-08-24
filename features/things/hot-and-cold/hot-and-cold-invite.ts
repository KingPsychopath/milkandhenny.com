import { buildAppUrl } from "@/lib/shared/app-url";

export const hotAndColdRoomPath = (roomId: string) =>
  `/things/hot-and-cold/${encodeURIComponent(roomId)}`;
export function buildHotAndColdInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, hotAndColdRoomPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
export function parseHotAndColdInviteFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}
