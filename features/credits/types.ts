export type CreditCampaign = {
  id: string;
  campaignKey: string;
  name: string;
  reason: string;
  sourceEventSlug: string | null;
  redemptionEventSlug: string | null;
  amountMinor: number;
  currency: string;
  claimExpiresAt: string;
  redeemExpiresAt: string | null;
  status: "draft" | "active" | "paused" | "closed";
  recipients: number;
  units: number;
  claimedRecipients: number;
  claimedUnits: number;
  redeemedUnits: number;
  revokedRecipients: number;
};

export type CreditClaim = {
  state: "available" | "claimed" | "expired" | "unavailable";
  campaignName: string;
  amountMinor: number;
  currency: string;
  units: number;
  totalMinor: number;
  emailHint: string;
  claimExpiresAt: string;
  redeemExpiresAt: string | null;
};

export type CreditGrant = {
  id: string;
  campaignId: string;
  email: string;
  displayName: string | null;
  units: number;
  reservedUnits: number;
  redeemedUnits: number;
  remainingUnits: number;
  claimedAt: string | null;
  revokedAt: string | null;
};

export type AccountCredit = {
  grantId: string;
  campaignName: string;
  amountMinor: number;
  currency: string;
  totalUnits: number;
  reservedUnits: number;
  redeemedUnits: number;
  remainingUnits: number;
  redemptionEventSlug: string | null;
  redemptionEventTitle: string | null;
  redeemExpiresAt: string | null;
};

export type CheckoutCreditReservation = {
  units: number;
  discountMinor: number;
  ticketAmountsMinor: number[];
  discounts: Array<{ units: number; amountMinor: number }>;
};
