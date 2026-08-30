import { appFragment, buildAppUrl } from "@/lib/shared/app-url";

export interface FamilyFeudInvitePayload {
  token: string;
  expiresAt: number;
}

export interface FamilyFeudPresenterInvitePayload extends FamilyFeudInvitePayload {
  controllerPairingToken: string;
  buzzerToken: string;
}

export interface FamilyFeudControllerInvitePayload extends FamilyFeudInvitePayload {
  buzzerToken: string;
}

function fragment(payload: FamilyFeudInvitePayload) {
  return appFragment({ token: payload.token, expires: payload.expiresAt });
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
    expires: payload.expiresAt,
  });
}

export function familyFeudControllerFragment(payload: FamilyFeudControllerInvitePayload) {
  return appFragment({
    token: payload.token,
    buzzer: payload.buzzerToken,
    expires: payload.expiresAt,
  });
}

export function familyFeudBuzzerFragment(payload: FamilyFeudInvitePayload) {
  return fragment(payload);
}

export function parseFamilyFeudPresenterFragment(value: string) {
  const invite = parse(value);
  if (!invite) return null;
  const params = new URLSearchParams(value.replace(/^#/, ""));
  const controllerPairingToken = params.get("controller") ?? "";
  const buzzerToken = params.get("buzzer") ?? "";
  if (!controllerPairingToken || !buzzerToken) return null;
  return { ...invite, controllerPairingToken, buzzerToken };
}
export function parseFamilyFeudControllerFragment(value: string) {
  const invite = parse(value);
  if (!invite) return null;
  const buzzerToken = new URLSearchParams(value.replace(/^#/, "")).get("buzzer") ?? "";
  return buzzerToken ? { ...invite, buzzerToken } : null;
}
export const parseFamilyFeudBuzzerFragment = parse;

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
  payload: FamilyFeudInvitePayload,
) {
  return buildAppUrl(origin, `/things/family-feud/${encodeURIComponent(roomId)}/buzzer`, {
    fragment: familyFeudBuzzerFragment(payload),
  });
}
