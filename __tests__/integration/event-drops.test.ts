import { it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

/**
 * Event guest drops, against real Postgres (the transfer itself uses the
 * in-memory test store). What matters: a token only resolves while the drop
 * is live, the kill switch is instant, and re-enabling keeps the album.
 */

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";
import { putEvent } from "@/features/events/store.server";
import { normaliseEventInput } from "@/features/events/events.server";
import {
  cancelEventDropSchedule,
  disableEventDrop,
  enableEventDrop,
  getEventDrop,
  getEventDropSchedule,
  isValidDropToken,
  processScheduledEventDrops,
  resolveDropToken,
  scheduleEventDrop,
} from "@/features/events/drop.server";
import { getTransfer } from "@/features/transfers/store.server";

const SLUG = "drop-night";
const DAY = 24 * 60 * 60;

async function seedEvent(): Promise<void> {
  const result = normaliseEventInput({
    slug: SLUG,
    title: "Drop Night",
    status: "published",
    area: "East London",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    ticketTypes: [
      {
        id: "entry",
        name: "Entry",
        priceMinor: 0,
        currency: "GBP",
        quantity: 10,
        perPersonLimit: 2,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error);
  await putEvent(result.value);
}

describeWithDatabase("event drops (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedEvent();
  });

  it("enables, resolves, and kills a drop", async () => {
    const enabled = await enableEventDrop(SLUG, 7 * DAY);
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.value.live).toBe(true);
    expect(isValidDropToken(enabled.value.token)).toBe(true);
    expect(await getTransfer(enabled.value.transferId)).not.toBeNull();

    const resolved = await resolveDropToken(enabled.value.token);
    expect(resolved?.eventSlug).toBe(SLUG);
    expect(resolved?.eventTitle).toBe("Drop Night");

    await disableEventDrop(SLUG);
    expect(await resolveDropToken(enabled.value.token)).toBeNull();
    expect((await getEventDrop(SLUG))?.live).toBe(false);
  });

  it("re-enabling keeps the album guests already filled", async () => {
    const first = await enableEventDrop(SLUG, 7 * DAY);
    if (!first.ok) throw new Error(first.error);
    await disableEventDrop(SLUG);

    const second = await enableEventDrop(SLUG, 7 * DAY);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.transferId).toBe(first.value.transferId);
    expect(second.value.live).toBe(true);
    expect(await resolveDropToken(first.value.token)).not.toBeNull();
  });

  it("rejects silly expiries and unknown events", async () => {
    expect((await enableEventDrop(SLUG, 60)).ok).toBe(false);
    expect((await enableEventDrop(SLUG, 90 * DAY)).ok).toBe(false);
    expect((await enableEventDrop("no-such-event", 7 * DAY)).ok).toBe(false);
  });

  it("opens a scheduled album once the event start is reached", async () => {
    const opensAt = new Date(Date.now() + 60_000);
    const scheduled = await scheduleEventDrop({
      eventSlug: SLUG,
      opensAt: opensAt.toISOString(),
      expirySeconds: 7 * DAY,
      actorId: "admin-test",
    });
    expect(scheduled.ok).toBe(true);
    expect(await getEventDrop(SLUG)).toBeNull();
    expect(await processScheduledEventDrops(new Date(opensAt.getTime() - 1))).toBe(0);
    await cancelEventDropSchedule(SLUG);
    expect(await processScheduledEventDrops(opensAt)).toBe(0);
    await scheduleEventDrop({
      eventSlug: SLUG,
      opensAt: opensAt.toISOString(),
      expirySeconds: 7 * DAY,
      actorId: "admin-test",
    });
    expect(await processScheduledEventDrops(opensAt)).toBe(1);
    expect((await getEventDrop(SLUG))?.live).toBe(true);
    expect((await getEventDropSchedule(SLUG))?.openedAt).toBeDefined();
    expect(await processScheduledEventDrops(opensAt)).toBe(0);
  });

  it("garbage tokens never resolve", async () => {
    expect(await resolveDropToken("nope")).toBeNull();
    expect(await resolveDropToken("drp_short")).toBeNull();
  });
});
