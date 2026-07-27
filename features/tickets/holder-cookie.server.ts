import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";

import { isValidEventSlug } from "@/features/events/types";

/**
 * Proof-of-ticket cookie.
 *
 * Opening a valid ticket page records which events this browser holds a
 * ticket for, which is what unlocks the exact address on the event page.
 * The value is signed so it cannot simply be typed in: these events happen
 * in someone's home, and the address is the thing being protected.
 *
 * This is a convenience marker, not an authorization token — every action
 * that actually matters re-checks the ticket server-side.
 */

const COOKIE_NAME = "mah-ticket-holder";
const SIGNING_LABEL = "milkandhenny/ticket-holder/v1";
const MAX_SLUGS = 12;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

function getSigningKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim().length < 16) return null;
  return createHmac("sha256", secret).update(SIGNING_LABEL).digest();
}

function sign(payload: string): string | null {
  const key = getSigningKey();
  if (!key) return null;
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

function verify(payload: string, signature: string): boolean {
  const expected = sign(payload);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Event slugs this browser has proven it holds a ticket for. */
export function readTicketHolderSlugs(): string[] {
  const raw = getCookie(COOKIE_NAME);
  if (!raw || typeof raw !== "string") return [];

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return [];

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!verify(payload, signature)) return [];

  return payload.split(",").filter(isValidEventSlug).slice(0, MAX_SLUGS);
}

/** Record a proven ticket for `slug`, preserving any already recorded. */
export function rememberTicketHolder(slug: string): void {
  if (!isValidEventSlug(slug)) return;

  const existing = readTicketHolderSlugs();
  if (existing.includes(slug)) return;

  // Newest first, so a long-running browser keeps its most recent events.
  const next = [slug, ...existing].slice(0, MAX_SLUGS);
  const payload = next.join(",");
  const signature = sign(payload);
  if (!signature) return;

  setCookie(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
