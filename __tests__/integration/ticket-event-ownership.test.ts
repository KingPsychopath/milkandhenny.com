import { afterAll, beforeAll, expect, it } from "vitest";

import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("ticket event ownership", () => {
  beforeAll(async () => {
    await applySchema();
    await query(`
      insert into events (slug, title, starts_at)
      values ('ownership-a', 'A', now()), ('ownership-b', 'B', now());
      insert into ticket_types (event_slug, id, name)
      values ('ownership-a', 'entry', 'Entry'), ('ownership-b', 'entry', 'Entry');
      insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
      values ('parent-a', 'ownership-a', 'entry', 'Parent', 'order-a');
    `);
  });
  afterAll(closeDatabase);

  it("rejects a parent ticket from another event", async () => {
    await expect(
      query(`
        insert into tickets
          (id, event_slug, ticket_type_id, holder_name, order_id, parent_ticket_id)
        values ('child-b', 'ownership-b', 'entry', 'Child', 'order-b', 'parent-a')
      `),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a participant linked to another event's ticket", async () => {
    await expect(
      query(
        "update event_participants set event_slug = 'ownership-b' where ticket_id = 'parent-a'",
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("preserves valid links through event rename and parent deletion", async () => {
    await query(`
      insert into tickets
        (id, event_slug, ticket_type_id, holder_name, order_id, parent_ticket_id)
      values ('child-a', 'ownership-a', 'entry', 'Child', 'order-a', 'parent-a');
    `);
    await query("update events set slug = 'ownership-renamed' where slug = 'ownership-a'");
    const links = await query<{
      event_slug: string;
      parent_ticket_id: string | null;
      participant_event_slug: string;
    }>(`
      select t.event_slug, t.parent_ticket_id, p.event_slug as participant_event_slug
        from tickets t
        join event_participants p on p.ticket_id = t.id
       where t.id = 'child-a'
    `);
    expect(links[0]).toMatchObject({
      event_slug: "ownership-renamed",
      parent_ticket_id: "parent-a",
      participant_event_slug: "ownership-renamed",
    });

    await query("delete from event_participants where ticket_id = 'parent-a'");
    await query("delete from tickets where id = 'parent-a'");
    const child = await query<{ parent_ticket_id: string | null }>(
      "select parent_ticket_id from tickets where id = 'child-a'",
    );
    expect(child[0]?.parent_ticket_id).toBeNull();
  });
});
