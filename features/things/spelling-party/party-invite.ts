import { appFragment, buildAppUrl } from "@/lib/shared/app-url";

export interface PartyPresenterInvite {
  presenterToken: string;
  joinToken: string;
  expiresAt?: number;
}

export function partyPlayerPath(roomId: string) {
  return `/things/spelling-party/${encodeURIComponent(roomId)}`;
}

export function partyPresenterPath(roomId: string) {
  return `${partyPlayerPath(roomId)}/present`;
}

export function partyPresenterFragment(invite: PartyPresenterInvite) {
  return appFragment({
    presenter: invite.presenterToken,
    join: invite.joinToken,
    expires: invite.expiresAt,
  });
}

export function parsePartyPresenterFragment(fragment: string): PartyPresenterInvite {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const expires = Number(params.get("expires"));
  return {
    presenterToken: params.get("presenter") ?? "",
    joinToken: params.get("join") ?? "",
    expiresAt: Number.isFinite(expires) && expires > 0 ? expires : undefined,
  };
}

export function parsePartyPlayerFragment(fragment: string) {
  const value = fragment.replace(/^#/, "").trim();
  if (!value.includes("=")) return value;
  return new URLSearchParams(value).get("join") ?? "";
}

export function buildPartyPlayerInviteUrl(origin: string, roomId: string, joinToken: string) {
  return buildAppUrl(origin, partyPlayerPath(roomId), { fragment: { join: joinToken } });
}
