import { createServerFn } from "@tanstack/react-start";

import { getAttendeeSession } from "@/features/attendee-access/session.server";
import { claimCredit, creditClaimAccountState, inspectCreditClaim } from "./credits.server";

export const inspectCreditClaimFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => inspectCreditClaim(data.token));

export const claimCreditFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(({ data }) => claimCredit(data.token));

export const creditClaimAccountStateFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const session = await getAttendeeSession();
    return creditClaimAccountState(data.token, session?.personId);
  });
