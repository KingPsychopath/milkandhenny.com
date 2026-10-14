import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifySonderSignature,
  fetchSonderOrders,
  SonderReadError,
} from "@/lib/platform/sonder.server";
import {
  activeSonderTicket,
  chooseBookingTeam,
  parseSonderEvent,
  parseSonderOrder,
} from "@/features/sonder/types";
import { sonderOrder, HANGOUT, EVENT_ID } from "../helpers/sonder";

describe("Sonder contracts", () => {
  it("authenticates raw bytes with the whole prefixed secret and rejects tampering and old/future signatures", () => {
    const now = 1_800_000_000_000,
      secret = "whsec_synthetic-only",
      body = Buffer.from('{ "id": "example" }');
    const signature = (timestamp: number) =>
      `t=${timestamp},v1=${createHmac("sha256", secret)
        .update(timestamp + ".")
        .update(body)
        .digest("hex")}`;
    expect(verifySonderSignature(body, signature(now / 1000), secret, now)).toBe(true);
    for (const timestamp of [now / 1000 - 301, now / 1000 + 301])
      expect(verifySonderSignature(body, signature(timestamp), secret, now)).toBe(false);
    expect(
      verifySonderSignature(Buffer.from('{"id":"example"}'), signature(now / 1000), secret, now),
    ).toBe(false);
    for (const header of [null, "v1=wrong", "t=9999999999999999999,v1=" + "a".repeat(64)])
      expect(verifySonderSignature(body, header, secret, now)).toBe(false);
  });
  it("accepts no-order test and unknown events, but rejects wrong mode/version/header identity", () => {
    const body = {
      id: EVENT_ID,
      version: 1,
      type: "webhook.test",
      mode: "test",
      occurred_at: new Date().toISOString(),
      data: { message: "Connected to Sonder" },
    };
    expect(parseSonderEvent(body, EVENT_ID, "test").hangoutId).toBeNull();
    expect(
      parseSonderEvent({ ...body, type: "future.type", data: {} }, EVENT_ID, "test").type,
    ).toBe("future.type");
    expect(
      parseSonderEvent(
        { ...body, type: "future.type", data: { hangout_id: HANGOUT } },
        EVENT_ID,
        "test",
      ).hangoutId,
    ).toBe(HANGOUT);
    expect(
      parseSonderEvent({ ...body, type: "future.type", data: null }, EVENT_ID, "test").hangoutId,
    ).toBeNull();
    for (const changed of [{ version: 2 }, { mode: "live" }, { id: HANGOUT }])
      expect(() => parseSonderEvent({ ...body, ...changed }, EVENT_ID, "test")).toThrow();
  });
  it("counts checked-in tickets as active and excludes review/cancelled orders; does not retain QR credentials", () => {
    const order = parseSonderOrder(sonderOrder());
    expect(JSON.stringify(order)).not.toContain("qr_payload");
    const ticket = { ...order.tickets[0]!, status: "checked_in" as const };
    expect(activeSonderTicket(order, ticket)).toBe(true);
    expect(activeSonderTicket({ ...order, review_required: true }, ticket)).toBe(false);
    expect(activeSonderTicket(order, ticket, true)).toBe(false);
    expect(() => parseSonderOrder({ ...sonderOrder(), quantity: 2 })).toThrow();
    expect(
      chooseBookingTeam([
        { id: "b", size: 2 },
        { id: "a", size: 1 },
      ]),
    ).toBe("a");
  });
  it("reads all pages with a read key and checks mode, ownership and advancing cursors", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-read-key");
      return Response.json({
        mode: "test",
        hangout_id: HANGOUT,
        cancelled_at: null,
        orders: [sonderOrder()],
        next_cursor: urls.length === 1 ? "page-two" : null,
      });
    };
    expect(
      (
        await fetchSonderOrders({
          hangoutId: HANGOUT,
          mode: "test",
          apiKey: "synthetic-read-key",
          signal: new AbortController().signal,
          fetcher,
        })
      ).orders,
    ).toHaveLength(1);
    expect(urls[1]).toContain("after=page-two");
    for (const status of [401, 429])
      await expect(
        fetchSonderOrders({
          hangoutId: HANGOUT,
          mode: "test",
          apiKey: "synthetic-read-key",
          signal: new AbortController().signal,
          fetcher: async () => new Response(null, { status }),
        }),
      ).rejects.toBeInstanceOf(SonderReadError);
    await expect(
      fetchSonderOrders({
        hangoutId: HANGOUT,
        mode: "live",
        apiKey: "synthetic-read-key",
        signal: new AbortController().signal,
        fetcher,
      }),
    ).rejects.toThrow("scope");
  });
});
