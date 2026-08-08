/**
 * Ticket domain types and pure helpers.
 *
 * Browser-safe. Signing lives in `qr.server.ts`; nothing here touches a secret.
 */

export const TICKET_STATUSES = ["valid", "void", "refunded"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_KINDS = ["paid", "free", "comp"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export type TicketRecord = {
  id: string;
  eventSlug: string;
  ticketTypeId: string;
  kind: TicketKind;
  status: TicketStatus;

  holderName: string;
  /** Stored for delivery and resend. Comps added at the door may have none. */
  email?: string;
  /** SHA-256 of the normalised email. Indexes are keyed on this, never the address. */
  emailHash?: string;

  /** Groups tickets issued together (one checkout, or a guest plus their plus-ones). */
  orderId: string;
  /** Set on a plus-one, pointing at the ticket it was issued alongside. */
  parentTicketId?: string;

  issuedAt: string;
  redeemedAt?: string;
  /** Free-text marker for who scanned it, e.g. "door-1". Not an account. */
  redeemedBy?: string;
  /** Set when a redemption arrives from a device that was offline at the door. */
  redeemedOffline?: boolean;

  /** Stripe session/payment reference. Absent for free and comp tickets. */
  paymentRef?: string;
  amountPaidMinor?: number;
  currency?: string;

  notes?: string;
};

/** What the door needs to make a decision, and nothing else. */
export type DoorTicketView = {
  id: string;
  /** Groups tickets that arrived in one purchase or comp issuance. */
  orderId: string;
  holderName: string;
  ticketTypeName: string;
  kind: TicketKind;
  status: TicketStatus;
  redeemedAt?: string;
  isPlusOne: boolean;
};

/** Safe sibling-ticket detail exposed to someone holding one ticket in the order. */
export type OrderTicketView = {
  id: string;
  holderName: string;
  status: TicketStatus;
  redeemedAt?: string;
  amountPaidMinor?: number;
  currency?: string;
};

/** Bearer-page projection; payment references and buyer email never reach the browser. */
export type TicketPageTicket = {
  id: string;
  holderName: string;
  kind: TicketKind;
  status: TicketStatus;
  redeemedAt?: string;
  amountPaidMinor?: number;
  currency?: string;
};

export type RedeemOutcome =
  | { result: "admitted"; ticket: DoorTicketView }
  | { result: "already-redeemed"; ticket: DoorTicketView; redeemedAt: string }
  | { result: "void"; ticket: DoorTicketView }
  | { result: "wrong-event"; ticket: DoorTicketView }
  | { result: "invalid" }
  | { result: "not-found" };

/**
 * QR payload wire format: `mah1.<ticketId>.<signature>`.
 *
 * Versioned so the signing key or algorithm can be rotated without
 * invalidating scanners in the field.
 */
export const TICKET_QR_VERSION = "mah1";

const TICKET_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidTicketId(value: unknown): value is string {
  return typeof value === "string" && TICKET_ID_PATTERN.test(value);
}

export type ParsedQrPayload = { ticketId: string; signature: string };

/**
 * Parse and shape-check a scanned payload.
 *
 * Returning `null` here means "this is not one of our QR codes at all" —
 * it says nothing about whether the signature is genuine, which only the
 * server can decide.
 */
export function parseTicketQrPayload(raw: string): ParsedQrPayload | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Scanners may hand us the full ticket URL rather than the raw payload.
  const candidate = extractPayloadFromUrl(trimmed) ?? trimmed;

  const parts = candidate.split(".");
  if (parts.length !== 3) return null;
  const [version, ticketId, signature] = parts;
  if (version !== TICKET_QR_VERSION) return null;
  if (!isValidTicketId(ticketId)) return null;
  if (!SIGNATURE_PATTERN.test(signature)) return null;
  return { ticketId, signature };
}

function extractPayloadFromUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("t");
    if (fromQuery) return fromQuery;
    const last = url.pathname.split("/").filter(Boolean).pop();
    return last ?? null;
  } catch {
    return null;
  }
}

export function formatTicketQrPayload(ticketId: string, signature: string): string {
  return `${TICKET_QR_VERSION}.${ticketId}.${signature}`;
}

/** Normalised before hashing so `A@B.com ` and `a@b.com` resolve identically. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

/**
 * Offline door manifest.
 *
 * Holds truncated hashes of valid ticket ids, never the ids themselves, so a
 * stolen device does not become a ticket forgery kit. 96 bits is far beyond
 * collision range for events of this size.
 */
export const MANIFEST_HASH_LENGTH = 24;

export type DoorManifest = {
  eventSlug: string;
  generatedAt: string;
  /** Truncated SHA-256 hex digests of valid, unredeemed-or-redeemed ticket ids. */
  hashes: string[];
};

/** Browser-side hashing for the offline path. Uses WebCrypto, not Node. */
export async function hashTicketIdInBrowser(ticketId: string): Promise<string> {
  const bytes = new TextEncoder().encode(ticketId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, MANIFEST_HASH_LENGTH);
}
