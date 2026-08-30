import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  eventCancellationPending,
  runEventCancellation,
} from "@/features/event-operations/cancellation.server";
import { normaliseEventInput } from "@/features/events/events.server";
import { putEvent } from "@/features/events/store.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

process.env.AUTH_SECRET = "event-cancellation-test-secret-at-least-32-characters";

describeWithDatabase("event cancellation workflow state (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);

  it("retries an incomplete cancellation but not an already completed workflow", async () => {
    const event = normaliseEventInput({
      slug: "cancellation-night",
      title: "Cancellation Night",
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
    if (!event.ok) throw new Error(event.error);
    await putEvent(event.value);

    await expect(eventCancellationPending(event.value.slug, "published")).resolves.toBe(false);
    await expect(eventCancellationPending(event.value.slug, "cancelled")).resolves.toBe(true);

    await query("update events set status = 'cancelled' where slug = $1", [event.value.slug]);
    await expect(eventCancellationPending(event.value.slug, "cancelled")).resolves.toBe(true);

    await query(
      `insert into attendee_operations_audit_events
       (action, actor_type, actor_id, event_slug, entity_type, entity_id, after_state, reason)
       values ('event.cancellation.completed', 'admin', 'admin-test', $1, 'event', $1,
               '{"status":"cancelled"}'::jsonb, 'weather')`,
      [event.value.slug],
    );
    await expect(eventCancellationPending(event.value.slug, "cancelled")).resolves.toBe(false);
  });

  it("cancels pending ticket actions and revokes their links", async () => {
    const event = normaliseEventInput({
      slug: "cancelled-actions",
      title: "Cancelled Actions",
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
    if (!event.ok) throw new Error(event.error);
    await putEvent(event.value);
    const issued = await issueTickets({
      eventSlug: event.value.slug,
      ticketTypeId: "entry",
      holderName: "Guest",
      quantity: 1,
      kind: "free",
    });
    if (!issued.ok) throw new Error(issued.error);
    const ticket = issued.value.tickets[0]!;
    const personId = "0198e9d8-53d7-7db7-9834-8896a69f1bdb";
    await query(`insert into event_people (id,canonical_name) values ($1,'Purchaser')`, [personId]);
    await query(
      `insert into attendee_action_links
         (id,token_hash,purpose,intended_email_hash,intended_email_hint,entity_type,entity_id,
          issued_by_type,issued_by_id,expires_at)
       values ('action_cancel_test',$1,'ticket-assignment',$2,'g•••@example.com',
               'ticket-assignment','assign_cancel_test','attendee',$3,now() + interval '1 day')`,
      ["a".repeat(64), "b".repeat(64), personId],
    );
    await query(
      `insert into ticket_assignments
         (id,event_slug,ticket_id,purchaser_person_id,recipient_email,recipient_email_hash,
          recipient_email_hint,action_link_id,expires_at)
       values ('assign_cancel_test',$1,$2,$3,'guest@example.com',$4,'g•••@example.com',
               'action_cancel_test',now() + interval '1 day')`,
      [event.value.slug, ticket.id, personId, "b".repeat(64)],
    );
    await query(`update events set status = 'cancelled' where slug = $1`, [event.value.slug]);

    await runEventCancellation({
      eventSlug: event.value.slug,
      actorId: "admin-test",
      actorType: "admin",
      reason: "Venue unavailable",
    });

    await expect(
      query<{ status: string }>(`select status from ticket_assignments where id = $1`, [
        "assign_cancel_test",
      ]),
    ).resolves.toEqual([{ status: "cancelled" }]);
    const links = await query<{ revoked: boolean }>(
      `select revoked_at is not null as revoked from attendee_action_links where id = $1`,
      ["action_cancel_test"],
    );
    expect(links).toEqual([{ revoked: true }]);
  });
});
