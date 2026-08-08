import { buildAppUrl } from "@/lib/shared/app-url";

export function sameBrainPlayerPath(roomId: string) {
  return `/things/same-brain/${encodeURIComponent(roomId)}`;
}

export function parseSameBrainPlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildSameBrainPlayerInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, sameBrainPlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
