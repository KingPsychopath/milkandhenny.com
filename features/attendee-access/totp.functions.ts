import { createServerFn } from "@tanstack/react-start";

import { getAttendeeSession, pendingMfaIsFresh } from "@/features/event-scoring/session.server";
import {
  beginTotpEnrollment,
  disableTotp,
  finishTotpEnrollment,
  personTotpStatus,
  regenerateRecoveryCodes,
  verifyPendingRecoveryCode,
  verifyPendingTotp,
} from "./totp.server";

export const getMfaChallengeFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  return session?.pendingMfa && pendingMfaIsFresh(session.pendingMfa)
    ? { required: true as const, returnTo: session.pendingMfa.returnTo }
    : { required: false as const, returnTo: "/my" };
});

export const verifyTotpFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => verifyPendingTotp(data.token));

export const verifyRecoveryCodeFn = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(({ data }) => verifyPendingRecoveryCode(data.code));

export const getTotpStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAttendeeSession();
  return session?.personId
    ? { ok: true as const, value: await personTotpStatus(session.personId) }
    : { ok: false as const, status: 401, error: "Sign in first" };
});

export const beginTotpEnrollmentFn = createServerFn({ method: "POST" }).handler(() =>
  beginTotpEnrollment(),
);

export const finishTotpEnrollmentFn = createServerFn({ method: "POST" })
  .validator((data: { enrollmentId: string; token: string }) => data)
  .handler(({ data }) => finishTotpEnrollment(data));

export const disableTotpFn = createServerFn({ method: "POST" }).handler(() => disableTotp());

export const regenerateRecoveryCodesFn = createServerFn({ method: "POST" }).handler(() =>
  regenerateRecoveryCodes(),
);
