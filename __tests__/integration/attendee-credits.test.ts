import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  claimCredit,
  creditClaimAccountState,
  createCreditCampaignFromTickets,
  inspectCreditClaim,
  issueCreditClaimLink,
  listAccountCredits,
  listCreditCampaigns,
  listCreditGrants,
  redeemCreditReservation,
  releaseCreditReservation,
  reserveCreditsForCheckout,
  revokeCreditGrant,
  setCreditRedemptionEvent,
} from "@/features/credits/credits.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("attendee credits (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);

  async function seedTickets() {
    await query(
      `insert into events (slug,title,status,starts_at) values
       ('credit-night','Credit Night','published',now() + interval '1 day')`,
    );
    await query(
      `insert into ticket_types
         (event_slug,id,name,price_minor,currency,quantity,per_person_limit)
       values ('credit-night','food','Entry + Food',1500,'GBP',20,8)`,
    );
    await query(
      `insert into tickets
         (id,event_slug,ticket_type_id,status,holder_name,email,order_id)
       values
         ('CREDIT0000000001','credit-night','food','valid','Owen','owen@example.com','ord_one'),
         ('CREDIT0000000002','credit-night','food','valid','Owen','OWEN@example.com','ord_one'),
         ('CREDIT0000000003','credit-night','food','valid','Ada','ada@example.com','ord_two'),
         ('CREDIT0000000004','credit-night','food','refunded','Nope','nope@example.com','ord_three')`,
    );
  }

  it("creates one grant per purchaser with one unit per valid eligible ticket", async () => {
    await seedTickets();
    const campaign = await createCreditCampaignFromTickets({
      campaignKey: "credit-night-food-thanks",
      name: "Food-ticket thank you",
      reason: "Food was shared with everybody",
      sourceEventSlug: "credit-night",
      ticketTypeId: "food",
      amountMinor: 500,
      currency: "GBP",
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(campaign).toMatchObject({ recipients: 2, units: 3, amountMinor: 500 });
    expect(await listCreditGrants(campaign.id)).toEqual([
      expect.objectContaining({ email: "ada@example.com", units: 1 }),
      expect.objectContaining({ email: "owen@example.com", units: 2 }),
    ]);
  });

  it("uses private one-use links and makes repeat claims harmless", async () => {
    await seedTickets();
    const campaign = await createCreditCampaignFromTickets({
      campaignKey: "credit-night-food-thanks",
      name: "Food-ticket thank you",
      reason: "Food was shared with everybody",
      sourceEventSlug: "credit-night",
      ticketTypeId: "food",
      amountMinor: 500,
      currency: "GBP",
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const first = await issueCreditClaimLink({
      campaignId: campaign.id,
      email: "owen@example.com",
      origin: "https://example.com",
    });
    const second = await issueCreditClaimLink({
      campaignId: campaign.id,
      email: "owen@example.com",
      origin: "https://example.com",
    });
    const firstToken = first.url.split("/").at(-1)!;
    const secondToken = second.url.split("/").at(-1)!;

    expect((await inspectCreditClaim(firstToken))?.state).toBe("unavailable");
    expect(await inspectCreditClaim(secondToken)).toMatchObject({
      state: "available",
      units: 2,
      amountMinor: 500,
      totalMinor: 1000,
      emailHint: "o•••@example.com",
    });
    expect((await claimCredit(secondToken))?.state).toBe("claimed");
    expect((await claimCredit(secondToken))?.state).toBe("claimed");
    expect((await listCreditCampaigns())[0]).toMatchObject({
      claimedRecipients: 1,
      claimedUnits: 2,
    });
  });

  it("makes every outstanding claim link unavailable when a grant is revoked", async () => {
    await seedTickets();
    const campaign = await createCreditCampaignFromTickets({
      campaignKey: "credit-night-food-thanks",
      name: "Food-ticket thank you",
      reason: "Food was shared with everybody",
      sourceEventSlug: "credit-night",
      ticketTypeId: "food",
      amountMinor: 500,
      currency: "GBP",
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const link = await issueCreditClaimLink({
      campaignId: campaign.id,
      email: "ada@example.com",
      origin: "https://example.com",
    });
    expect(await revokeCreditGrant(campaign.id, "ada@example.com")).toBe(true);
    expect((await inspectCreditClaim(link.url.split("/").at(-1)!))?.state).toBe("unavailable");
  });

  it("links a claimed grant to a verified account without requiring an account to claim", async () => {
    await seedTickets();
    const campaign = await createCreditCampaignFromTickets({
      campaignKey: "credit-night-food-thanks",
      name: "Food-ticket thank you",
      reason: "Food was shared with everybody",
      sourceEventSlug: "credit-night",
      ticketTypeId: "food",
      amountMinor: 500,
      currency: "GBP",
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const link = await issueCreditClaimLink({
      campaignId: campaign.id,
      email: "owen@example.com",
      origin: "https://example.com",
    });
    const token = link.url.split("/").at(-1)!;
    expect(await creditClaimAccountState(token)).toBe("signed-out");
    await claimCredit(token);

    const personId = "01990a1f-3b7c-7000-8000-000000000001";
    await query(`insert into event_people (id,canonical_name) values ($1,'Owen')`, [personId]);
    await query(
      `insert into event_person_identifiers
         (id,person_id,kind,value_hash,verified_at)
       values ('01990a1f-3b7c-7000-8000-000000000002',$1,'email',$2,now())`,
      [personId, createHash("sha256").update("owen@example.com").digest("hex")],
    );

    expect(await creditClaimAccountState(token, personId)).toBe("linked");
    expect(await listAccountCredits(personId)).toEqual([
      expect.objectContaining({
        campaignName: "Food-ticket thank you",
        totalUnits: 2,
        remainingUnits: 2,
      }),
    ]);
  });

  it("reserves at most one unit per admission ticket and releases or redeems explicitly", async () => {
    await seedTickets();
    await query(
      `insert into events (slug,title,status,starts_at) values
       ('next-night','Next Night','published',now() + interval '30 days')`,
    );
    const campaign = await createCreditCampaignFromTickets({
      campaignKey: "credit-night-food-thanks",
      name: "Food-ticket thank you",
      reason: "Food was shared with everybody",
      sourceEventSlug: "credit-night",
      ticketTypeId: "food",
      amountMinor: 500,
      currency: "GBP",
      claimExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await setCreditRedemptionEvent({ campaignId: campaign.id, eventSlug: "next-night" });
    const link = await issueCreditClaimLink({
      campaignId: campaign.id,
      email: "owen@example.com",
      origin: "https://example.com",
    });
    await claimCredit(link.url.split("/").at(-1)!);

    const reserve = (reference: string, quantity: number) =>
      transaction((client) =>
        reserveCreditsForCheckout(client, {
          checkoutReference: reference,
          email: "OWEN@example.com",
          eventSlug: "next-night",
          quantity,
          ticketPriceMinor: 1000,
          currency: "GBP",
          minimumChargeMinor: 30,
          expiresAt: new Date(Date.now() + 1_800_000),
        }),
      );

    expect(await reserve("checkout_one", 1)).toMatchObject({
      units: 1,
      discountMinor: 500,
      ticketAmountsMinor: [500],
    });
    expect(await reserve("checkout_one", 1)).toMatchObject({ units: 1, discountMinor: 500 });
    expect(await reserve("checkout_two", 1)).toMatchObject({ units: 1, discountMinor: 500 });
    expect(await reserve("checkout_three", 1)).toMatchObject({ units: 0, discountMinor: 0 });

    await releaseCreditReservation("checkout_two");
    expect(await reserve("checkout_four", 2)).toMatchObject({
      units: 1,
      discountMinor: 500,
      ticketAmountsMinor: [500, 1000],
    });
    await redeemCreditReservation("checkout_one", "order_one");

    expect(await listCreditGrants(campaign.id)).toEqual([
      expect.objectContaining({
        email: "owen@example.com",
        units: 2,
        reservedUnits: 1,
        redeemedUnits: 1,
        remainingUnits: 0,
      }),
      expect.anything(),
    ]);
  });
});
