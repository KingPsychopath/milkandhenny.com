import { transaction } from "@/lib/platform/postgres.server";

/** Record the most recent compatible alert that led to a paid checkout. */
export async function recordWaitlistConversionForCheckout(checkoutRef: string): Promise<boolean> {
  return transaction(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [checkoutRef]);
    const result = await client.query<{ id: string }>(
      `with purchase as (
       select event_slug, ticket_type_id, email, order_id, min(issued_at) as issued_at
         from tickets
        where checkout_ref = $1 and kind = 'paid' and email is not null
        group by event_slug, ticket_type_id, email, order_id
     ), candidate as (
       select entry.id, purchase.order_id, purchase.issued_at
         from purchase
         join event_waitlist_entries entry
           on entry.event_slug = purchase.event_slug
          and lower(trim(entry.email)) = lower(trim(purchase.email))
          and (entry.scope_kind = 'event' or entry.ticket_type_id = purchase.ticket_type_id)
          and entry.status = 'notified'
          and entry.notified_at <= purchase.issued_at
          and not exists (
            select 1 from event_waitlist_entries converted
             where converted.converted_order_id = purchase.order_id
          )
        order by entry.notified_at desc, entry.created_at desc, entry.id desc
        limit 1
        for update of entry
     )
     update event_waitlist_entries entry
        set status = 'converted', converted_at = candidate.issued_at,
            converted_order_id = candidate.order_id, updated_at = now()
       from candidate
      where entry.id = candidate.id
      returning entry.id`,
      [checkoutRef],
    );
    return result.rows.length > 0;
  });
}
