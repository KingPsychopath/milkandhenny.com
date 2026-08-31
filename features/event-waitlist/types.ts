export const WAITLIST_STATUSES = [
  "pending",
  "active",
  "notified",
  "left",
  "expired",
  "undeliverable",
] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export type WaitlistScope = { kind: "event" } | { kind: "ticket-type"; ticketTypeId: string };

export interface WaitlistManagementView {
  eventSlug: string;
  eventTitle: string;
  eventPath: string;
  scopeLabel: string;
  emailHint: string;
  status: WaitlistStatus;
  confirmationExpired: boolean;
}

export interface AdminWaitlistEntry {
  id: string;
  email: string;
  scopeLabel: string;
  ticketTypeId?: string;
  status: WaitlistStatus;
  createdAt: string;
  confirmedAt?: string;
  notifiedAt?: string;
  leftAt?: string;
}

export interface WaitlistAdminView {
  counts: Record<WaitlistStatus, number>;
  entries: AdminWaitlistEntry[];
}

export interface WaitlistImpactScope {
  ticketTypeId?: string;
  label: string;
  count: number;
}

export interface WaitlistImpact {
  count: number;
  scopes: WaitlistImpactScope[];
}

export function waitlistPath(token: string): string {
  return `/waitlist/${token}`;
}
