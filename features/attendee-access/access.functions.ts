import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  currentAttendeeAccountStatus,
  currentAttendeeAccountView,
  inspectAttendeeAccessLink,
  removeAttendeeEmail,
  requestAttendeeAccess,
  requestFingerprint,
  updateAttendeeName,
  verifyAttendeeAccess,
} from "./access.server";
import {
  ensureAttendeeSession,
  getAttendeeSession,
  signOutAttendeeSession,
} from "@/features/event-scoring/session.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { personTotpStatus } from "./totp.server";
import { listPersonPasskeys } from "./passkeys.server";
import { sendPersonSecurityNotice } from "./security-notifications.server";
import { establishEmailAuthenticatedSession } from "./email-authentication.server";

const accountLoginRedirect = () =>
  redirect({ to: "/access", search: { returnTo: "/my" }, replace: true });

export const requireAttendeeAccountFn = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await currentAttendeeAccountStatus())) throw accountLoginRedirect();
  return { authenticated: true as const };
});

export const getAttendeeShellFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return { authenticated: await currentAttendeeAccountStatus() };
  } catch {
    return { authenticated: false };
  }
});

export const getMyAccountFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  const view = await currentAttendeeAccountView();
  if (!view.account || !session?.personId) throw accountLoginRedirect();
  const [passkeys, totp] = await Promise.all([
    listPersonPasskeys(session.personId),
    personTotpStatus(session.personId),
  ]);
  return {
    account: view.account,
    emailStepUpRequired: view.emailStepUpRequired,
    security: { passkeys, totp },
  };
});

export const requestAttendeeAccessFn = createServerFn({ method: "POST" })
  .validator(
    (data: { email: string; returnTo?: string; purpose?: "sign-in" | "add-email" }) => data,
  )
  .handler(async ({ data }) => {
    const request = getRequest();
    const session = await getAttendeeSession();
    const purpose = data.purpose === "add-email" ? "add-email" : "sign-in";
    return requestAttendeeAccess({
      email: data.email,
      origin: getBaseUrlForRequest(request),
      ipFingerprint: requestFingerprint(request),
      returnTo: data.returnTo,
      purpose,
      authenticatedPersonId: purpose === "add-email" ? session?.personId : undefined,
      authenticatedAt: purpose === "add-email" ? session?.authenticatedAt : undefined,
    });
  });

export const verifyAttendeeAccessFn = createServerFn({ method: "POST" })
  .validator(
    (data: { challengeId?: string; token?: string; email?: string; code?: string }) => data,
  )
  .handler(async ({ data }) => {
    const session = await ensureAttendeeSession();
    const result = await verifyAttendeeAccess({
      sessionId: session.id,
      ipFingerprint: requestFingerprint(getRequest()),
      challengeId: data.challengeId,
      token: data.token,
      email: data.email,
      code: data.code,
    });
    if (!result.ok) return result;
    const authentication = await establishEmailAuthenticatedSession({
      personId: result.value.personId,
      verifiedEmailHash: result.value.emailHash,
      returnTo: result.value.returnTo,
    });
    if (result.value.purpose === "add-email") {
      await sendPersonSecurityNotice({
        personId: result.value.personId,
        subject: "A sign-in email was added",
        message: "A new verified email address was connected to your account.",
      });
    }
    return {
      ok: true as const,
      value: {
        returnTo: authentication.destination,
        mfaRequired: authentication.mfaRequired,
      },
    };
  });

export const inspectAttendeeAccessLinkFn = createServerFn({ method: "GET" })
  .validator((data: { challengeId?: string; token?: string }) => data)
  .handler(({ data }) => inspectAttendeeAccessLink(data));

export const updateAttendeeNameFn = createServerFn({ method: "POST" })
  .validator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    return session?.personId
      ? updateAttendeeName(session.personId, data.name)
      : { ok: false as const, status: 401, error: "Sign in first" };
  });

export const signOutAttendeeFn = createServerFn({ method: "POST" }).handler(async () => {
  await signOutAttendeeSession();
  return { ok: true as const };
});

export const removeAttendeeEmailFn = createServerFn({ method: "POST" })
  .validator((data: { identifierId: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    return session?.personId
      ? removeAttendeeEmail({
          personId: session.personId,
          identifierId: data.identifierId,
          authenticatedAt: session.authenticatedAt,
        })
      : { ok: false as const, status: 401, error: "Sign in first" };
  });
