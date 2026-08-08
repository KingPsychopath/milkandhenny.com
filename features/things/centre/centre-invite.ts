import { buildAppUrl } from "@/lib/shared/app-url";

export function centrePlayerPath(roomId: string) {
  return `/things/centre/${encodeURIComponent(roomId)}`;
}

export function parseCentrePlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildCentrePlayerInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, centrePlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
