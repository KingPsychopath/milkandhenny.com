import { buildAppUrl } from "@/lib/shared/app-url";

import type { LiarsMode } from "./types";

export function liarsPlayerPath(roomId: string) {
  return `/things/liars/${encodeURIComponent(roomId)}`;
}

export function liarsSetupPath(mode: LiarsMode): "/things/mafia" | "/things/imposter" {
  return mode === "mafia" ? "/things/mafia" : "/things/imposter";
}

export function parseLiarsPlayerFragment(fragment: string) {
  return new URLSearchParams(fragment.replace(/^#/, "")).get("join") ?? "";
}

export function buildLiarsPlayerInviteUrl(origin: string, roomId: string, joinToken?: string) {
  return buildAppUrl(origin, liarsPlayerPath(roomId), {
    fragment: joinToken ? { join: joinToken } : undefined,
  });
}
