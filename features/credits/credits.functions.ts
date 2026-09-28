import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { getAttendeeSession } from "@/features/attendee-access/session.server";
import {
  claimCredit,
  creditClaimAccountState,
  inspectCreditClaim,
  listCreditCampaigns,
  listCreditGrants,
  listCreditRedemptionEvents,
} from "./credits.server";

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

async function requireCreditsAccess() {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageCommunications)
    throw new Error("Communications access required");
}

export const getAdminCreditsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireCreditsAccess();
  const [campaigns, events] = await Promise.all([
    listCreditCampaigns(),
    listCreditRedemptionEvents(),
  ]);
  return { campaigns, events };
});

export const getAdminCreditGrantsFn = createServerFn({ method: "GET" })
  .validator((data: { campaignId: string }) => ({ campaignId: data.campaignId.slice(0, 128) }))
  .handler(async ({ data }) => {
    await requireCreditsAccess();
    return listCreditGrants(data.campaignId);
  });
