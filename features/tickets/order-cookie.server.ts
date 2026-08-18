import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";

/**
 * Signed proof that this browser opened the purchaser ticket for an order.
 *
 * The primary ticket grants access to every QR in its order. A child ticket
 * grants access only to itself, so forwarding that link does not forward the
 * rest of the order or its refund controls.
 */

const COOKIE_NAME = "mah-ticket-orders";
const SIGNING_LABEL = "milkandhenny/ticket-orders/v1";
const ORDER_ID_PATTERN = /^ord_[A-Za-z0-9_-]{16}$/;
const MAX_ORDERS = 12;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

function signingKey(): Buffer | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim().length < 16) return null;
  return createHmac("sha256", secret).update(SIGNING_LABEL).digest();
}

function sign(payload: string): string | null {
  const key = signingKey();
  if (!key) return null;
  return createHmac("sha256", key).update(payload).digest("base64url").slice(0, 22);
}

function validSignature(payload: string, signature: string): boolean {
  const expected = sign(payload);
  if (!expected) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function readManagedTicketOrders(): string[] {
  const raw = getCookie(COOKIE_NAME);
  if (!raw || typeof raw !== "string") return [];

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return [];

  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!validSignature(payload, signature)) return [];

  return payload
    .split(",")
    .filter((orderId) => ORDER_ID_PATTERN.test(orderId))
    .slice(0, MAX_ORDERS);
}

export function rememberManagedTicketOrder(orderId: string): void {
  if (!ORDER_ID_PATTERN.test(orderId)) return;

  const existing = readManagedTicketOrders();
  if (existing.includes(orderId)) return;

  const payload = [orderId, ...existing].slice(0, MAX_ORDERS).join(",");
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
