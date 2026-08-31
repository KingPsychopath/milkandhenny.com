import { appFragment, buildAppUrl } from "@/lib/shared/app-url";
import type { FamilyFeudTeamId } from "./types";

export interface FamilyFeudInvitePayload {
  token: string;
  expiresAt: number;
}

export interface FamilyFeudPresenterInvitePayload extends FamilyFeudInvitePayload {
  controllerPairingToken: string;
  buzzerToken: string;
  buzzerTokens: Record<FamilyFeudTeamId, string>;
}

export interface FamilyFeudControllerInvitePayload extends FamilyFeudInvitePayload {
  buzzerToken: string;
  buzzerTokens: Record<FamilyFeudTeamId, string>;
}

export interface FamilyFeudBuzzerInvitePayload extends FamilyFeudInvitePayload {
  teamId?: FamilyFeudTeamId;
}

function parse(value: string) {
  const params = new URLSearchParams(value.replace(/^#/, ""));
  const token = params.get("token") ?? "";
  const expiresAt = Number(params.get("expires"));
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return { token, expiresAt };
}

export function familyFeudPresenterFragment(payload: FamilyFeudPresenterInvitePayload) {
  return appFragment({
    token: payload.token,
    controller: payload.controllerPairingToken,
    buzzer: payload.buzzerToken,
    buzzerOne: payload.buzzerTokens.one,
    buzzerTwo: payload.buzzerTokens.two,
    expires: payload.expiresAt,
  });
}

export function familyFeudControllerFragment(payload: FamilyFeudControllerInvitePayload) {
  return appFragment({
    token: payload.token,
    buzzer: payload.buzzerToken,
    buzzerOne: payload.buzzerTokens.one,
    buzzerTwo: payload.buzzerTokens.two,
    expires: payload.expiresAt,
  });
}

export function familyFeudBuzzerFragment(payload: FamilyFeudBuzzerInvitePayload) {
  return appFragment({
    token: payload.token,
    team: payload.teamId,
    expires: payload.expiresAt,
  });
}

function parseBuzzerTokens(params: URLSearchParams, fallback: string) {
  return {
    one: params.get("buzzerOne") ?? fallback,
    two: params.get("buzzerTwo") ?? fallback,
  } satisfies Record<FamilyFeudTeamId, string>;
}

export function parseFamilyFeudPresenterFragment(value: string) {
  const invite = parse(value);
  if (!invite) return null;
  const params = new URLSearchParams(value.replace(/^#/, ""));
  const controllerPairingToken = params.get("controller") ?? "";
  const buzzerToken = params.get("buzzer") ?? "";
  if (!controllerPairingToken || !buzzerToken) return null;
  return {
    ...invite,
    controllerPairingToken,
    buzzerToken,
    buzzerTokens: parseBuzzerTokens(params, buzzerToken),
  };
}
export function parseFamilyFeudControllerFragment(value: string) {
  const invite = parse(value);
  if (!invite) return null;
  const params = new URLSearchParams(value.replace(/^#/, ""));
  const buzzerToken = params.get("buzzer") ?? "";
  return buzzerToken
    ? { ...invite, buzzerToken, buzzerTokens: parseBuzzerTokens(params, buzzerToken) }
    : null;
}
export function parseFamilyFeudBuzzerFragment(value: string) {
  const invite = parse(value);
  if (!invite) return null;
  const team = new URLSearchParams(value.replace(/^#/, "")).get("team");
  const teamId: FamilyFeudTeamId | undefined = team === "one" || team === "two" ? team : undefined;
  return { ...invite, teamId };
}

export function familyFeudControllerUrl(
  origin: string,
  roomId: string,
  payload: FamilyFeudControllerInvitePayload,
) {
  return buildAppUrl(origin, `/things/family-feud/${encodeURIComponent(roomId)}/control`, {
    fragment: familyFeudControllerFragment(payload),
  });
}

export function familyFeudBuzzerUrl(
  origin: string,
  roomId: string,
  payload: FamilyFeudBuzzerInvitePayload,
) {
  return buildAppUrl(origin, `/things/family-feud/${encodeURIComponent(roomId)}/buzzer`, {
    fragment: familyFeudBuzzerFragment(payload),
  });
}
