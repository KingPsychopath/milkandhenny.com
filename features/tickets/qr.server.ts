import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  MANIFEST_HASH_LENGTH,
  TICKET_QR_VERSION,
  formatTicketQrPayload,
  isValidTicketId,
  normaliseEmail,
} from "./types";

/**
 * Ticket identity and QR signing.
 *
 * The signing key is derived from `AUTH_SECRET` rather than adding another
 * secret to the deployment contract. Derivation is domain-separated so a
 * ticket signature can never be replayed as an auth token, and vice versa.
 */

const TICKET_SIGNING_LABEL = "milkandhenny/ticket-qr/v1";
const SIGNATURE_BYTES = 16;

/** Crockford base32 without I, L, O or U — unambiguous when read aloud at a door. */
const ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_LENGTH = 16;

export class TicketSigningUnavailableError extends Error {
  constructor() {
    super("AUTH_SECRET must be set before tickets can be issued");
    this.name = "TicketSigningUnavailableError";
  }
}

function getSigningKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim().length < 16) throw new TicketSigningUnavailableError();
  return createHmac("sha256", secret).update(TICKET_SIGNING_LABEL).digest();
}

export function isTicketSigningConfigured(): boolean {
  const secret = process.env.AUTH_SECRET;
  return Boolean(secret && secret.trim().length >= 16);
}

/**
 * 80 bits of entropy over an unambiguous alphabet.
 *
 * Rejection sampling keeps the distribution uniform — taking `byte % 32`
 * would bias the first 24 symbols.
 */
export function generateTicketId(): string {
  let id = "";
  while (id.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH)) {
      if (byte >= 256 - (256 % ID_ALPHABET.length)) continue;
      id += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (id.length === ID_LENGTH) break;
    }
  }
  return id;
}

export function generateOrderId(): string {
  return `ord_${randomBytes(12).toString("base64url")}`;
}

function signatureFor(ticketId: string): string {
  return createHmac("sha256", getSigningKey())
    .update(`${TICKET_QR_VERSION}.${ticketId}`)
    .digest("base64url")
    .slice(0, Math.ceil((SIGNATURE_BYTES * 8) / 6));
}

export function signTicketId(ticketId: string): string {
  if (!isValidTicketId(ticketId)) throw new Error("Refusing to sign a malformed ticket id");
  return signatureFor(ticketId);
}

export function buildTicketQrPayload(ticketId: string): string {
  return formatTicketQrPayload(ticketId, signTicketId(ticketId));
}

/** Constant-time verification. A length mismatch short-circuits before compare. */
export function verifyTicketSignature(ticketId: string, signature: string): boolean {
  if (!isValidTicketId(ticketId) || typeof signature !== "string") return false;
  let expected: string;
  try {
    expected = signatureFor(ticketId);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Matches `hashTicketIdInBrowser` exactly — the offline door path depends on it. */
export function hashTicketId(ticketId: string): string {
  return createHash("sha256").update(ticketId).digest("hex").slice(0, MANIFEST_HASH_LENGTH);
}

/** Emails are indexed by hash so a Redis dump is not a mailing list. */
export function hashEmail(email: string): string {
  return createHash("sha256")
    .update(`${TICKET_SIGNING_LABEL}:${normaliseEmail(email)}`)
    .digest("hex")
    .slice(0, 32);
}
