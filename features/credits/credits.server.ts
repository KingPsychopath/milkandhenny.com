import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { normaliseEmail } from "@/lib/shared/email-address";
import { buildAppUrl } from "@/lib/shared/app-url";
import type {
  AccountCredit,
  CheckoutCreditReservation,
  CreditCampaign,
  CreditClaim,
  CreditGrant,
} from "./types";

export type {
  AccountCredit,
  CheckoutCreditReservation,
  CreditCampaign,
  CreditClaim,
  CreditGrant,
} from "./types";

type ClaimRow = {
  link_id: string;
  link_expires_at: Date;
  consumed_at: Date | null;
  link_revoked_at: Date | null;
  grant_id: string;
  email: string;
  units_total: number;
  claimed_at: Date | null;
  grant_revoked_at: Date | null;
  campaign_name: string;
  amount_minor: number;
  currency: string;
  claim_expires_at: Date;
  redeem_expires_at: Date | null;
  campaign_status: CreditCampaign["status"];
};

function emailHash(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = normaliseEmail(email).split("@");
  return `${local.slice(0, 1)}${local.length > 1 ? "•••" : ""}@${domain}`;
}

function claimFromRow(row: ClaimRow): CreditClaim {
  const now = Date.now();
  const unavailable =
    row.link_revoked_at || row.grant_revoked_at || row.campaign_status !== "active";
  const expired = row.link_expires_at.getTime() <= now || row.claim_expires_at.getTime() <= now;
  return {
    state: unavailable
      ? "unavailable"
      : row.claimed_at || row.consumed_at
        ? "claimed"
        : expired
          ? "expired"
          : "available",
    campaignName: row.campaign_name,
    amountMinor: row.amount_minor,
    currency: row.currency,
    units: row.units_total,
    totalMinor: row.amount_minor * row.units_total,
    emailHint: maskEmail(row.email),
    claimExpiresAt: row.claim_expires_at.toISOString(),
    redeemExpiresAt: row.redeem_expires_at?.toISOString() ?? null,
  };
}

async function claimRow(client: Pick<PoolClient, "query">, token: string, lock = false) {
  const result = await client.query<ClaimRow>(
    `select l.id as link_id, l.expires_at as link_expires_at, l.consumed_at,
            l.revoked_at as link_revoked_at, g.id as grant_id, g.email, g.units_total,
            g.claimed_at, g.revoked_at as grant_revoked_at, c.name as campaign_name,
            c.amount_minor, c.currency, c.claim_expires_at, c.redeem_expires_at,
            c.status as campaign_status
       from attendee_credit_claim_links l
       join attendee_credit_grants g on g.id = l.grant_id
       join attendee_credit_campaigns c on c.id = g.campaign_id
      where l.token_hash = $1${lock ? " for update of l, g" : ""}`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

export async function inspectCreditClaim(token: string): Promise<CreditClaim | null> {
  if (!/^mhc_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const row = await queryOne<ClaimRow>(
    `select l.id as link_id, l.expires_at as link_expires_at, l.consumed_at,
            l.revoked_at as link_revoked_at, g.id as grant_id, g.email, g.units_total,
            g.claimed_at, g.revoked_at as grant_revoked_at, c.name as campaign_name,
            c.amount_minor, c.currency, c.claim_expires_at, c.redeem_expires_at,
            c.status as campaign_status
       from attendee_credit_claim_links l
       join attendee_credit_grants g on g.id = l.grant_id
       join attendee_credit_campaigns c on c.id = g.campaign_id
      where l.token_hash = $1`,
    [tokenHash(token)],
  );
  return row ? claimFromRow(row) : null;
}

export type CreditClaimAccountState = "signed-out" | "linked" | "different-account";

export async function creditClaimAccountState(
  token: string,
  personId?: string,
): Promise<CreditClaimAccountState> {
  if (!personId) return "signed-out";
  if (!/^mhc_[A-Za-z0-9_-]{40,60}$/.test(token)) return "different-account";
  const row = await queryOne<{ linked: boolean }>(
    `select exists (
       select 1
         from attendee_credit_claim_links l
         join attendee_credit_grants g on g.id = l.grant_id
         join event_person_identifiers identifier
           on identifier.person_id = $2
          and identifier.kind = 'email'
          and identifier.verified_at is not null
          and identifier.historical_until is null
          and identifier.value_hash = g.email_hash
        where l.token_hash = $1
     ) as linked`,
    [tokenHash(token), personId],
  );
  return row?.linked ? "linked" : "different-account";
}

export async function claimCredit(token: string): Promise<CreditClaim | null> {
  if (!/^mhc_[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return transaction(async (client) => {
    const row = await claimRow(client, token, true);
    if (!row) return null;
    const projected = claimFromRow(row);
    if (projected.state !== "available") return projected;
    await client.query(
      `update attendee_credit_grants set claimed_at = now(), updated_at = now()
        where id = $1 and claimed_at is null and revoked_at is null`,
      [row.grant_id],
    );
    await client.query(
      `update attendee_credit_claim_links set consumed_at = coalesce(consumed_at, now())
        where id = $1`,
      [row.link_id],
    );
    return { ...projected, state: "claimed" as const };
  });
}

export async function issueCreditClaimLink(input: {
  campaignId: string;
  email: string;
  origin: string;
}): Promise<{ url: string; claim: CreditClaim }> {
  const token = `mhc_${randomBytes(32).toString("base64url")}`;
  const row = await transaction(async (client) => {
    const result = await client.query<ClaimRow>(
      `select null::text as link_id, c.claim_expires_at as link_expires_at,
              null::timestamptz as consumed_at, null::timestamptz as link_revoked_at,
              g.id as grant_id, g.email, g.units_total, g.claimed_at,
              g.revoked_at as grant_revoked_at, c.name as campaign_name, c.amount_minor,
              c.currency, c.claim_expires_at, c.redeem_expires_at,
              c.status as campaign_status
         from attendee_credit_grants g
         join attendee_credit_campaigns c on c.id = g.campaign_id
        where g.campaign_id = $1 and g.email_hash = $2
        for update of g`,
      [input.campaignId, emailHash(input.email)],
    );
    const grant = result.rows[0];
    if (!grant || grant.grant_revoked_at || grant.campaign_status !== "active") {
      throw new Error("This recipient does not have an active credit grant");
    }
    await client.query(
      `update attendee_credit_claim_links set revoked_at = now()
        where grant_id = $1 and consumed_at is null and revoked_at is null`,
      [grant.grant_id],
    );
    const linkId = randomUUID();
    await client.query(
      `insert into attendee_credit_claim_links (id,grant_id,token_hash,expires_at)
       values ($1,$2,$3,$4)`,
      [linkId, grant.grant_id, tokenHash(token), grant.claim_expires_at],
    );
    return { ...grant, link_id: linkId };
  });
  return {
    url: buildAppUrl(input.origin, `/credit/${token}`),
    claim: claimFromRow(row),
  };
}

export async function createCreditCampaignFromTickets(input: {
  campaignKey: string;
  name: string;
  reason: string;
  sourceEventSlug: string;
  ticketTypeId: string;
  amountMinor: number;
  currency: string;
  claimExpiresAt: Date;
  redeemExpiresAt?: Date | null;
}): Promise<CreditCampaign> {
  const key = input.campaignKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(key)) throw new Error("Use a simple campaign key");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1)
    throw new Error("Credit must be a positive whole minor-unit amount");
  if (input.claimExpiresAt.getTime() <= Date.now()) throw new Error("Claim expiry must be future");
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `insert into attendee_credit_campaigns
         (id,campaign_key,name,reason,source_event_slug,amount_minor,currency,
          claim_expires_at,redeem_expires_at,status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
       on conflict (campaign_key) do update set
         name = excluded.name, reason = excluded.reason,
         claim_expires_at = excluded.claim_expires_at,
         redeem_expires_at = excluded.redeem_expires_at, updated_at = now()
       returning id`,
      [
        id,
        key,
        input.name.trim(),
        input.reason.trim(),
        input.sourceEventSlug,
        input.amountMinor,
        input.currency.toUpperCase(),
        input.claimExpiresAt,
        input.redeemExpiresAt ?? null,
      ],
    );
    const campaign = await client.query<{ id: string }>(
      `select id from attendee_credit_campaigns where campaign_key = $1`,
      [key],
    );
    const campaignId = campaign.rows[0]?.id;
    if (!campaignId) throw new Error("Credit campaign could not be created");
    const recipients = await client.query<{
      email: string;
      display_name: string | null;
      units: number;
    }>(
      `select lower(trim(email)) as email, nullif(trim(max(holder_name)), '') as display_name,
              count(*)::integer as units
         from tickets
        where event_slug = $1 and ticket_type_id = $2 and status = 'valid'
          and email is not null and trim(email) <> ''
        group by lower(trim(email))`,
      [input.sourceEventSlug, input.ticketTypeId],
    );
    for (const recipient of recipients.rows) {
      await client.query(
        `insert into attendee_credit_grants
           (id,campaign_id,email,email_hash,display_name,units_total)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (campaign_id,email_hash) do update set
           email = excluded.email, display_name = excluded.display_name,
           units_total = excluded.units_total, updated_at = now()`,
        [
          randomUUID(),
          campaignId,
          recipient.email,
          emailHash(recipient.email),
          recipient.display_name,
          recipient.units,
        ],
      );
    }
  });
  const campaign = (await listCreditCampaigns()).find((item) => item.campaignKey === key);
  if (!campaign) throw new Error("Credit campaign could not be loaded");
  return campaign;
}

export async function listCreditCampaigns(): Promise<CreditCampaign[]> {
  const rows = await query<Record<string, unknown>>(
    `select c.*,
            count(g.id) filter (where g.revoked_at is null)::integer as recipients,
            coalesce(sum(g.units_total) filter (where g.revoked_at is null),0)::integer as units,
            count(g.id) filter (where g.claimed_at is not null and g.revoked_at is null)::integer as claimed_recipients,
            coalesce(sum(g.units_total) filter (where g.claimed_at is not null and g.revoked_at is null),0)::integer as claimed_units,
            coalesce((select sum(r.units) from attendee_credit_redemptions r
                       join attendee_credit_grants rg on rg.id = r.grant_id
                      where rg.campaign_id = c.id and r.status = 'redeemed'),0)::integer as redeemed_units,
            count(g.id) filter (where g.revoked_at is not null)::integer as revoked_recipients
       from attendee_credit_campaigns c
       left join attendee_credit_grants g on g.campaign_id = c.id
      group by c.id order by c.created_at desc`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    campaignKey: String(row.campaign_key),
    name: String(row.name),
    reason: String(row.reason),
    sourceEventSlug: typeof row.source_event_slug === "string" ? row.source_event_slug : null,
    redemptionEventSlug:
      typeof row.redemption_event_slug === "string" ? row.redemption_event_slug : null,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    claimExpiresAt: new Date(row.claim_expires_at as Date).toISOString(),
    redeemExpiresAt: row.redeem_expires_at
      ? new Date(row.redeem_expires_at as Date).toISOString()
      : null,
    status: row.status as CreditCampaign["status"],
    recipients: Number(row.recipients),
    units: Number(row.units),
    claimedRecipients: Number(row.claimed_recipients),
    claimedUnits: Number(row.claimed_units),
    redeemedUnits: Number(row.redeemed_units),
    revokedRecipients: Number(row.revoked_recipients),
  }));
}

export async function listCreditGrants(campaignId: string): Promise<CreditGrant[]> {
  const rows = await query<Record<string, unknown>>(
    `select g.id,g.campaign_id,g.email,g.display_name,g.units_total,g.claimed_at,g.revoked_at,
            coalesce((select sum(r.units) from attendee_credit_redemptions r
                       where r.grant_id = g.id and r.status = 'reserved'),0)::integer as reserved_units,
            coalesce((select sum(r.units) from attendee_credit_redemptions r
                       where r.grant_id = g.id and r.status = 'redeemed'),0)::integer as redeemed_units
       from attendee_credit_grants g where g.campaign_id = $1
      order by revoked_at nulls first, claimed_at desc nulls last, email`,
    [campaignId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    campaignId: String(row.campaign_id),
    email: String(row.email),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    units: Number(row.units_total),
    reservedUnits: Number(row.reserved_units),
    redeemedUnits: Number(row.redeemed_units),
    remainingUnits: Math.max(
      0,
      Number(row.units_total) - Number(row.reserved_units) - Number(row.redeemed_units),
    ),
    claimedAt: row.claimed_at ? new Date(row.claimed_at as Date).toISOString() : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as Date).toISOString() : null,
  }));
}

export async function listCreditRedemptionEvents(): Promise<
  Array<{ slug: string; title: string; startsAt: string }>
> {
  const rows = await query<{ slug: string; title: string; starts_at: Date }>(
    `select slug,title,starts_at from events
      where status in ('draft','published','sold_out')
      order by starts_at desc limit 100`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    startsAt: row.starts_at.toISOString(),
  }));
}

export async function setCreditRedemptionEvent(input: {
  campaignId: string;
  eventSlug: string | null;
  redeemExpiresAt?: Date | null;
}): Promise<void> {
  if (input.eventSlug) {
    const event = await queryOne<{ slug: string }>(`select slug from events where slug = $1`, [
      input.eventSlug,
    ]);
    if (!event) throw new Error("Choose an existing event");
  }
  await query(
    `update attendee_credit_campaigns
        set redemption_event_slug = $2, redeem_expires_at = $3, updated_at = now()
      where id = $1`,
    [input.campaignId, input.eventSlug, input.redeemExpiresAt ?? null],
  );
}

export async function listAccountCredits(personId: string): Promise<AccountCredit[]> {
  const rows = await query<Record<string, unknown>>(
    `select g.id as grant_id,c.name as campaign_name,c.amount_minor,c.currency,
            g.units_total,c.redemption_event_slug,e.title as redemption_event_title,
            c.redeem_expires_at,
            coalesce((select sum(r.units) from attendee_credit_redemptions r
                       where r.grant_id = g.id and r.status = 'reserved'),0)::integer as reserved_units,
            coalesce((select sum(r.units) from attendee_credit_redemptions r
                       where r.grant_id = g.id and r.status = 'redeemed'),0)::integer as redeemed_units
       from attendee_credit_grants g
       join attendee_credit_campaigns c on c.id = g.campaign_id
       left join events e on e.slug = c.redemption_event_slug
      where g.claimed_at is not null and g.revoked_at is null
        and g.email_hash in (
          select value_hash from event_person_identifiers
           where person_id = $1 and kind = 'email' and verified_at is not null
             and historical_until is null
        )
      order by g.claimed_at desc,c.created_at desc`,
    [personId],
  );
  return rows.map((row) => {
    const totalUnits = Number(row.units_total);
    const reservedUnits = Number(row.reserved_units);
    const redeemedUnits = Number(row.redeemed_units);
    return {
      grantId: String(row.grant_id),
      campaignName: String(row.campaign_name),
      amountMinor: Number(row.amount_minor),
      currency: String(row.currency),
      totalUnits,
      reservedUnits,
      redeemedUnits,
      remainingUnits: Math.max(0, totalUnits - reservedUnits - redeemedUnits),
      redemptionEventSlug:
        typeof row.redemption_event_slug === "string" ? row.redemption_event_slug : null,
      redemptionEventTitle:
        typeof row.redemption_event_title === "string" ? row.redemption_event_title : null,
      redeemExpiresAt: row.redeem_expires_at
        ? new Date(row.redeem_expires_at as Date).toISOString()
        : null,
    };
  });
}

type ReservableGrant = {
  id: string;
  units_total: number;
  amount_minor: number;
};

type RedemptionRow = {
  grant_id: string;
  units: number;
  unit_amount_minor: number;
};

function reservationFromRows(
  rows: RedemptionRow[],
  quantity: number,
  ticketPriceMinor: number,
): CheckoutCreditReservation {
  const ticketAmountsMinor = Array.from({ length: quantity }, () => ticketPriceMinor);
  let ticketIndex = 0;
  const discounts = rows.map((row) => {
    for (let index = 0; index < row.units && ticketIndex < ticketAmountsMinor.length; index += 1) {
      ticketAmountsMinor[ticketIndex] = Math.max(
        0,
        ticketAmountsMinor[ticketIndex]! - row.unit_amount_minor,
      );
      ticketIndex += 1;
    }
    return { units: row.units, amountMinor: row.unit_amount_minor };
  });
  return {
    units: rows.reduce((sum, row) => sum + row.units, 0),
    discountMinor: rows.reduce((sum, row) => sum + row.units * row.unit_amount_minor, 0),
    ticketAmountsMinor,
    discounts,
  };
}

export async function reserveCreditsForCheckout(
  client: Pick<PoolClient, "query">,
  input: {
    checkoutReference: string;
    email: string;
    eventSlug: string;
    quantity: number;
    ticketPriceMinor: number;
    currency: string;
    minimumChargeMinor: number;
    expiresAt: Date;
  },
): Promise<CheckoutCreditReservation> {
  const existing = await client.query<RedemptionRow>(
    `select grant_id,units,unit_amount_minor from attendee_credit_redemptions
      where checkout_reference = $1 and status in ('reserved','redeemed')
      order by unit_amount_minor desc,created_at`,
    [input.checkoutReference],
  );
  if (existing.rows.length > 0) {
    return reservationFromRows(existing.rows, input.quantity, input.ticketPriceMinor);
  }

  const grants = await client.query<ReservableGrant>(
    `select g.id,g.units_total,c.amount_minor
       from attendee_credit_grants g
       join attendee_credit_campaigns c on c.id = g.campaign_id
      where g.email_hash = $1 and g.claimed_at is not null and g.revoked_at is null
        and c.status = 'active' and c.redemption_event_slug = $2
        and c.currency = $3
        and (c.redeem_expires_at is null or c.redeem_expires_at > now())
      order by c.amount_minor desc,c.redeem_expires_at asc nulls last,c.created_at
      for update of g`,
    [emailHash(input.email), input.eventSlug, input.currency.toUpperCase()],
  );
  let unitsLeft = input.quantity;
  let discountCapacity = Math.max(
    0,
    input.ticketPriceMinor * input.quantity - input.minimumChargeMinor,
  );
  const reserved: RedemptionRow[] = [];
  for (const grant of grants.rows) {
    if (unitsLeft === 0 || discountCapacity === 0) break;
    const used = await client.query<{ units: number }>(
      `select coalesce(sum(units),0)::integer as units
         from attendee_credit_redemptions
        where grant_id = $1 and status in ('reserved','redeemed')`,
      [grant.id],
    );
    const availableUnits = Math.max(0, grant.units_total - Number(used.rows[0]?.units ?? 0));
    const unitAmountMinor = Math.min(grant.amount_minor, input.ticketPriceMinor);
    if (availableUnits === 0 || unitAmountMinor <= 0) continue;
    const affordableUnits = Math.floor(discountCapacity / unitAmountMinor);
    const units = Math.min(unitsLeft, availableUnits, affordableUnits);
    if (units === 0) continue;
    await client.query(
      `insert into attendee_credit_redemptions
         (id,grant_id,checkout_reference,event_slug,units,unit_amount_minor,status,expires_at)
       values ($1,$2,$3,$4,$5,$6,'reserved',$7)`,
      [
        randomUUID(),
        grant.id,
        input.checkoutReference,
        input.eventSlug,
        units,
        unitAmountMinor,
        input.expiresAt,
      ],
    );
    reserved.push({ grant_id: grant.id, units, unit_amount_minor: unitAmountMinor });
    unitsLeft -= units;
    discountCapacity -= units * unitAmountMinor;
  }
  return reservationFromRows(reserved, input.quantity, input.ticketPriceMinor);
}

export async function attachCreditReservationToCheckout(
  checkoutReference: string,
  checkoutSessionId: string,
): Promise<void> {
  await query(
    `update attendee_credit_redemptions
        set checkout_session_id = $2,updated_at = now()
      where checkout_reference = $1 and status = 'reserved'`,
    [checkoutReference, checkoutSessionId],
  );
}

export async function releaseCreditReservation(checkoutReference: string): Promise<void> {
  await query(
    `update attendee_credit_redemptions
        set status = 'released',released_at = now(),updated_at = now()
      where checkout_reference = $1 and status = 'reserved'`,
    [checkoutReference],
  );
}

export async function redeemCreditReservation(
  checkoutReference: string,
  orderId: string,
): Promise<void> {
  await query(
    `update attendee_credit_redemptions
        set status = 'redeemed',order_id = $2,redeemed_at = now(),updated_at = now()
      where checkout_reference = $1 and status = 'reserved'`,
    [checkoutReference, orderId],
  );
}

export async function grantCredit(input: {
  campaignId: string;
  email: string;
  displayName?: string | null;
  units: number;
}): Promise<void> {
  const email = normaliseEmail(input.email);
  if (!email.includes("@")) throw new Error("Enter a valid email address");
  if (!Number.isSafeInteger(input.units) || input.units < 1 || input.units > 100)
    throw new Error("Choose between 1 and 100 credit units");
  await query(
    `insert into attendee_credit_grants
       (id,campaign_id,email,email_hash,display_name,units_total)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (campaign_id,email_hash) do update set
       email = excluded.email, display_name = coalesce(excluded.display_name, attendee_credit_grants.display_name),
       units_total = excluded.units_total, revoked_at = null, updated_at = now()`,
    [
      randomUUID(),
      input.campaignId,
      email,
      emailHash(email),
      input.displayName?.trim() || null,
      input.units,
    ],
  );
}

export async function revokeCreditGrant(campaignId: string, email: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update attendee_credit_grants set revoked_at = now(), updated_at = now()
      where campaign_id = $1 and email_hash = $2 and revoked_at is null returning id`,
    [campaignId, emailHash(email)],
  );
  return rows.length > 0;
}
