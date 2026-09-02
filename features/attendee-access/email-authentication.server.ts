import {
  authenticateAttendeeSession,
  beginAttendeeMfaSession,
} from "@/features/attendee-access/session.server";
import { personHasTotp } from "./totp.server";
import { safeReturnTo } from "./types";

export async function establishEmailAuthenticatedSession(input: {
  personId: string;
  verifiedEmailHash: string;
  returnTo: string;
}): Promise<{ destination: string; mfaRequired: boolean }> {
  const returnTo = safeReturnTo(input.returnTo);
  if (await personHasTotp(input.personId)) {
    await beginAttendeeMfaSession({
      personId: input.personId,
      verifiedEmailHash: input.verifiedEmailHash,
      returnTo,
    });
    return { destination: "/access/mfa", mfaRequired: true };
  }
  await authenticateAttendeeSession({
    personId: input.personId,
    verifiedEmailHash: input.verifiedEmailHash,
  });
  return { destination: returnTo, mfaRequired: false };
}
