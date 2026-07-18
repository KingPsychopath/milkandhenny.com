import { buildAppUrl } from "@/lib/shared/app-url";

export function drawCountryPlayerPath(roomId: string) {
  return `/things/draw-country/${encodeURIComponent(roomId)}`;
}

export function parseDrawCountryPlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildDrawCountryPlayerInviteUrl(
  origin: string,
  roomId: string,
  joinToken?: string,
) {
  return buildAppUrl(origin, drawCountryPlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
