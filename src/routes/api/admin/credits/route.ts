import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import {
  createCreditCampaignFromTickets,
  grantCredit,
  issueCreditClaimLink,
  listCreditCampaigns,
  listCreditGrants,
  listCreditRedemptionEvents,
  revokeCreditGrant,
  setCreditRedemptionEvent,
} from "@/features/credits/credits.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";

async function get(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const campaignId = new URL(request.url).searchParams.get("campaignId");
    return Response.json({
      campaigns: await listCreditCampaigns(),
      events: await listCreditRedemptionEvents(),
      ...(campaignId ? { grants: await listCreditGrants(campaignId) } : {}),
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.credits", "Could not load credits", error);
  }
}

async function post(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "create-from-tickets") {
      const amountMinor = Number(body.amountMinor);
      const claimExpiresAt = new Date(String(body.claimExpiresAt ?? ""));
      if (
        typeof body.campaignKey !== "string" ||
        typeof body.name !== "string" ||
        typeof body.sourceEventSlug !== "string" ||
        typeof body.ticketTypeId !== "string" ||
        !Number.isSafeInteger(amountMinor) ||
        Number.isNaN(claimExpiresAt.getTime())
      ) {
        return Response.json({ error: "Complete the campaign details" }, { status: 400 });
      }
      const campaign = await createCreditCampaignFromTickets({
        campaignKey: body.campaignKey,
        name: body.name,
        reason: typeof body.reason === "string" ? body.reason : "",
        sourceEventSlug: body.sourceEventSlug,
        ticketTypeId: body.ticketTypeId,
        amountMinor,
        currency: typeof body.currency === "string" ? body.currency : "GBP",
        claimExpiresAt,
        redeemExpiresAt:
          typeof body.redeemExpiresAt === "string" && body.redeemExpiresAt
            ? new Date(body.redeemExpiresAt)
            : null,
      });
      return Response.json({ campaign });
    }
    if (body.action === "claim-link") {
      if (typeof body.campaignId !== "string" || typeof body.email !== "string") {
        return Response.json({ error: "Choose a campaign and recipient" }, { status: 400 });
      }
      return Response.json(
        await issueCreditClaimLink({
          campaignId: body.campaignId,
          email: body.email,
          origin: getBaseUrlForRequest(request),
        }),
      );
    }
    if (body.action === "grant") {
      if (typeof body.campaignId !== "string" || typeof body.email !== "string") {
        return Response.json({ error: "Choose a campaign and recipient" }, { status: 400 });
      }
      await grantCredit({
        campaignId: body.campaignId,
        email: body.email,
        displayName: typeof body.displayName === "string" ? body.displayName : null,
        units: Number(body.units),
      });
      return Response.json({ ok: true });
    }
    if (body.action === "set-redemption-event") {
      if (typeof body.campaignId !== "string") {
        return Response.json({ error: "Choose a campaign" }, { status: 400 });
      }
      const redeemExpiresAt =
        typeof body.redeemExpiresAt === "string" && body.redeemExpiresAt
          ? new Date(body.redeemExpiresAt)
          : null;
      if (redeemExpiresAt && Number.isNaN(redeemExpiresAt.getTime())) {
        return Response.json({ error: "Choose a valid redemption deadline" }, { status: 400 });
      }
      await setCreditRedemptionEvent({
        campaignId: body.campaignId,
        eventSlug: typeof body.eventSlug === "string" && body.eventSlug ? body.eventSlug : null,
        redeemExpiresAt,
      });
      return Response.json({ ok: true });
    }
    if (body.action === "revoke") {
      if (typeof body.campaignId !== "string" || typeof body.email !== "string") {
        return Response.json({ error: "Choose a campaign and recipient" }, { status: 400 });
      }
      return Response.json({ revoked: await revokeCreditGrant(body.campaignId, body.email) });
    }
    return Response.json({ error: "Unknown credit action" }, { status: 400 });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.credits", "Could not update credits", error);
  }
}

export const Route = createFileRoute("/api/admin/credits")({
  server: {
    handlers: { GET: ({ request }) => get(request), POST: ({ request }) => post(request) },
  },
});
