import { buildAppUrl } from "@/lib/shared/app-url";

export function liarsPlayerPath(roomId: string) {
  return `/things/liars/${encodeURIComponent(roomId)}`;
}

export function parseLiarsPlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildLiarsPlayerInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, liarsPlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
