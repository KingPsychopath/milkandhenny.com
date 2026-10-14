import { createHmac, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  isSonderMode,
  nullableInstant,
  object,
  parseSonderOrder,
  type SonderMode,
  type SonderOrder,
} from "@/features/sonder/types";

export function sonderConfiguration() {
  const mode = process.env.SONDER_MODE;
  return {
    mode: isSonderMode(mode) ? mode : null,
    signingSecret: process.env.SONDER_WEBHOOK_SIGNING_SECRET,
    apiKey: process.env.SONDER_WEBHOOK_API_KEY,
  };
}
export function verifySonderSignature(
  raw: Uint8Array,
  header: string | null,
  secret: string,
  now = Date.now(),
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(match[1] + ".")
    .update(raw)
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}
export class SonderReadError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds = 300,
  ) {
    super(
      status === 401
        ? "Sonder access is paused or revoked"
        : status === 429
          ? "Sonder rate limit; sync will retry later"
          : "Sonder orders could not be read",
    );
  }
}
/** No provider mutations. Full scans restart at page one; cursors are not checkpoints. */
export async function fetchSonderOrders(input: {
  hangoutId: string;
  mode: SonderMode;
  apiKey: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ orders: SonderOrder[]; cancelledAt: string | null }> {
  const fetcher = input.fetcher ?? fetch,
    orders = new Map<string, SonderOrder>(),
    cursors = new Set<string>();
  let cursor: string | null = null,
    cancelledAt: string | null = null;
  for (let page = 0; page < 100; page++) {
    if (page) await delay(600, undefined, { signal: input.signal });
    const url = new URL(
      `https://api.findsonder.app/v1/host-integration/hangouts/${input.hangoutId}/orders`,
    );
    if (cursor) url.searchParams.set("after", cursor);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
      redirect: "error",
    });
    if (!response.ok) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new SonderReadError(
        response.status,
        Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 300,
      );
    }
    const row = object(await response.json());
    if (row.mode !== input.mode || row.hangout_id !== input.hangoutId || !Array.isArray(row.orders))
      throw new Error("Sonder response scope does not match this event");
    cancelledAt = nullableInstant(row.cancelled_at) ?? cancelledAt;
    for (const value of row.orders) {
      const order = parseSonderOrder(value);
      if (order.hangout_id !== input.hangoutId)
        throw new Error("Sonder order belongs to another hangout");
      orders.set(order.order_id, order);
    }
    if (row.next_cursor === null) return { orders: [...orders.values()], cancelledAt };
    if (typeof row.next_cursor !== "string" || !row.next_cursor || cursors.has(row.next_cursor))
      throw new Error("Sonder pagination did not advance");
    cursor = row.next_cursor;
    cursors.add(cursor);
  }
  throw new Error("Sonder sync exceeded its bounded page limit");
}
