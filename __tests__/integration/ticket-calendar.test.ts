import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { getTicketCalendarDocument } from "@/features/tickets/calendar.server";
import { generateTicketId } from "@/features/tickets/qr.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

async function issueCalendarTicket(slug: string) {
  const event = normaliseEventInput({
    slug,
    title: "Calendar Night",
    status: "published",
    area: "East London",
    venueName: "The Flat",
    address: "1 Private Road",
    doorCode: "2468",
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
  if (!event.ok) throw new Error(event.error);
  await putEvent(event.value);
  const issued = await issueTickets({
    eventSlug: event.value.slug,
    ticketTypeId: "entry",
    holderName: "Alice",
    quantity: 1,
    kind: "free",
  });
  if (!issued.ok) throw new Error(issued.error);
  return { event: event.value, ticket: issued.value.tickets[0]! };
}

describeWithDatabase("private ticket calendar authority (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);

  it("invalidates the old calendar bearer when a transfer rotates ticket authority", async () => {
    const { ticket } = await issueCalendarTicket("calendar-night");
    const original = await getTicketCalendarDocument(ticket.id, "https://milkandhenny.com");
    expect(original?.content).toContain(`/ticket/${ticket.id}`);
    expect(original?.content).toContain("1 Private Road");

    const rotated = generateTicketId();
    await query(`update tickets set access_reference = $2 where id = $1`, [ticket.id, rotated]);

    await expect(
      getTicketCalendarDocument(ticket.id, "https://milkandhenny.com"),
    ).resolves.toBeNull();
    const current = await getTicketCalendarDocument(rotated, "https://milkandhenny.com");
    expect(current?.content).toContain(`/ticket/${rotated}`);
    expect(current?.content).not.toContain(`/ticket/${ticket.id}`);
  });

  it("does not issue a private calendar after the event is cancelled", async () => {
    const { event, ticket } = await issueCalendarTicket("cancelled-calendar");
    await query(`update events set status = 'cancelled' where slug = $1`, [event.slug]);

    await expect(
      getTicketCalendarDocument(ticket.id, "https://milkandhenny.com"),
    ).resolves.toBeNull();
  });
});
