import { buildAppUrl } from "@/lib/shared/app-url";

export function twinPlayerPath(roomId: string) {
  return `/things/twin/${encodeURIComponent(roomId)}`;
}

export function parseTwinPlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildTwinPlayerInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, twinPlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
