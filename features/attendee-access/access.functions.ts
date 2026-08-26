import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  currentAttendeeAccountStatus,
  currentAttendeeAccountView,
  removeAttendeeEmail,
  requestAttendeeAccess,
  requestFingerprint,
  updateAttendeeName,
  verifyAttendeeAccess,
} from "./access.server";
import {
  authenticateAttendeeSession,
  ensureAttendeeSession,
  getAttendeeSession,
  signOutAttendeeSession,
} from "@/features/event-scoring/session.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";

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
  const view = await currentAttendeeAccountView();
  if (!view.account) throw accountLoginRedirect();
  return { account: view.account, emailStepUpRequired: view.emailStepUpRequired };
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
    await authenticateAttendeeSession({
      personId: result.value.personId,
      verifiedEmailHash: result.value.emailHash,
    });
    return { ok: true as const, value: { returnTo: result.value.returnTo } };
  });

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
