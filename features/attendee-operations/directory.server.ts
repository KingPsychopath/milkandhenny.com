import { query } from "@/lib/platform/postgres.server";
import { attendeeSessionSummaries } from "@/features/attendee-access/session.server";
import { actionEmailHash, maskActionEmail } from "./action-links.server";

export type PurchaserContactDirectoryEntry = {
  contactId: string;
  name?: string;
  emailHint: string;
  lastPurchasedAt: string;
  tickets: Array<{
    id: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    status: string;
    orderId: string;
    issuedAt: string;
    deliveryStatus?: string;
    deliveryNeedsAttention: boolean;
  }>;
};

export type PersonDirectoryEntry = {
  personId: string;
  canonicalName?: string;
  verifiedEmails: string[];
  identities: Array<{
    id: string;
    kind: "email";
    masked: string;
    status: "verified" | "pending" | "removed";
    verifiedAt?: string;
    removedAt?: string;
  }>;
  access: {
    acquisitionStatus: "active" | "restricted";
    restrictedAt?: string;
    restrictedBy?: string;
    restrictionReason?: string;
    activeSessions: number;
    lastSeenAt?: string;
    authenticatedAt?: string;
  };
  tickets: Array<{
    id: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    status: string;
    orderId: string;
    participantId?: string;
    checkedInAt?: string;
    amountPaidMinor?: number;
    currency?: string;
    supportNote?: string;
    otherOrderTickets: number;
    scoreBalance: number;
    transferHistory: Array<{ status: string; recipientEmailHint: string; createdAt: string }>;
    returnHistory: Array<{
      status: string;
      amountMinor?: number;
      currency?: string;
      createdAt: string;
    }>;
    exchanges: Array<{ status: string; amountDeltaMinor: number; createdAt: string }>;
    communication: { total: number; failed: number };
  }>;
  globalRoles: Array<{ role: string; status: string; expiresAt?: string }>;
  eventRoles: Array<{ eventSlug: string; label: string; status: string; expiresAt?: string }>;
  pendingInvitations: number;
  staffDevices: number;
  auditTimeline: Array<{ action: string; actorType: string; reason?: string; createdAt: string }>;
};

export async function searchPeople(queryText: string, limit = 30): Promise<PersonDirectoryEntry[]> {
  const search = queryText.trim().toLocaleLowerCase("en-GB");
  const exactEmailHash = search.includes("@") ? actionEmailHash(search) : "";
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const people = await query<{
    id: string;
    canonical_name: string | null;
    acquisition_status: "active" | "restricted";
    acquisition_restricted_at: Date | null;
    acquisition_restricted_by: string | null;
    acquisition_restriction_reason: string | null;
  }>(
    `select distinct person.id,person.canonical_name,person.acquisition_status,
            person.acquisition_restricted_at,person.acquisition_restricted_by,
            person.acquisition_restriction_reason
       from event_people person
       left join event_person_identifiers identifier on identifier.person_id = person.id
       left join event_participants participant on participant.person_id = person.id
       left join tickets ticket on ticket.id = participant.ticket_id
      where $1 = ''
         or lower(coalesce(person.canonical_name,'')) like '%' || $1 || '%'
         or lower(person.id::text) like '%' || $1 || '%'
         or lower(coalesce(identifier.display_hint,'')) like '%' || $1 || '%'
         or ($3 <> '' and identifier.kind = 'email' and identifier.value_hash = $3)
         or lower(coalesce(ticket.id,'')) like '%' || $1 || '%'
         or lower(coalesce(ticket.event_slug,'')) like '%' || $1 || '%'
         or exists (
           select 1
             from event_order_managers manager
             join tickets managed_ticket on managed_ticket.order_id = manager.order_id
            where manager.person_id = person.id and manager.status = 'active'
              and (lower(managed_ticket.id) like '%' || $1 || '%'
                or lower(managed_ticket.event_slug) like '%' || $1 || '%'
                or lower(managed_ticket.order_id) like '%' || $1 || '%')
         )
      order by person.canonical_name nulls last,person.id
      limit $2`,
    [search, boundedLimit, exactEmailHash],
  );
  if (!people.length) return [];
  const ids = people.map((person) => person.id);
  const [emails, tickets, globalRoles, eventRoles, invitations, devices, sessions] =
    await Promise.all([
      query<{
        id: string;
        person_id: string;
        display_hint: string;
        verified_at: Date | null;
        historical_until: Date | null;
      }>(
        `select id,person_id,coalesce(display_hint,'email identity') as display_hint,
                verified_at,historical_until
         from event_person_identifiers
        where person_id = any($1::uuid[]) and kind = 'email'
        order by verified_at desc nulls last,created_at desc`,
        [ids],
      ),
      query<{
        person_id: string;
        id: string;
        event_slug: string;
        event_title: string;
        holder_name: string;
        status: string;
        order_id: string;
        participant_id: string;
        checked_in_at: Date | null;
        amount_paid_minor: number | null;
        currency: string | null;
        notes: string | null;
        other_order_tickets: string;
      }>(
        `with ownership as (
           select participant.person_id,participant.ticket_id
             from event_participants participant
            where participant.person_id = any($1::uuid[])
           union
           select manager.person_id,ticket.id as ticket_id
             from event_order_managers manager
             join tickets ticket on ticket.order_id = manager.order_id
            where manager.person_id = any($1::uuid[]) and manager.status = 'active'
         )
         select ownership.person_id,ticket.id,ticket.event_slug,event.title as event_title,
              ticket.holder_name,ticket.status,ticket.order_id,participant.id as participant_id,
              participant.checked_in_at,ticket.amount_paid_minor,ticket.currency,ticket.notes,
              (select count(*) - 1 from tickets sibling where sibling.order_id = ticket.order_id)::text as other_order_tickets
         from ownership
         join tickets ticket on ticket.id = ownership.ticket_id
         join event_participants participant on participant.ticket_id = ticket.id
         join events event on event.slug = ticket.event_slug
        order by event.starts_at desc,ticket.issued_at`,
        [ids],
      ),
      query<{ person_id: string; role_preset: string; status: string; expires_at: Date | null }>(
        `select person_id,role_preset,status,expires_at from global_admin_grants
        where person_id = any($1::uuid[]) order by created_at desc`,
        [ids],
      ),
      query<{
        person_id: string;
        event_slug: string;
        label: string;
        status: string;
        expires_at: Date | null;
      }>(
        `select person_id,event_slug,label,status,expires_at from score_staff_assignments
        where person_id = any($1::uuid[]) order by created_at desc`,
        [ids],
      ),
      query<{ person_id: string; count: string }>(
        `select person_id,count(*)::text as count from (
         select purchaser_person_id as person_id from ticket_assignments where status = 'pending'
         union all select sender_person_id from ticket_transfers where status = 'pending'
       ) pending where person_id = any($1::uuid[]) group by person_id`,
        [ids],
      ),
      query<{ person_id: string; count: string }>(
        `select assignment.person_id,count(device.device_id)::text as count
         from score_staff_assignments assignment
         join score_staff_devices device on device.assignment_id = assignment.id and device.revoked_at is null
        where assignment.person_id = any($1::uuid[])
        group by assignment.person_id`,
        [ids],
      ),
      attendeeSessionSummaries(ids),
    ]);
  const ticketIds = tickets.map((ticket) => ticket.id);
  const participantIds = tickets.map((ticket) => ticket.participant_id);
  const [transfers, returns, exchanges, scores, communications, audit] = ticketIds.length
    ? await Promise.all([
        query<{
          ticket_id: string;
          status: string;
          recipient_email_hint: string;
          created_at: Date;
        }>(
          `select ticket_id,status,recipient_email_hint,created_at from ticket_transfers
            where ticket_id = any($1::text[]) order by created_at desc`,
          [ticketIds],
        ),
        query<{
          ticket_id: string;
          status: string;
          amount_minor: number | null;
          currency: string | null;
          created_at: Date;
        }>(
          `select ticket_id,status,amount_minor,currency,created_at from ticket_return_requests
            where ticket_id = any($1::text[]) order by created_at desc`,
          [ticketIds],
        ),
        query<{ ticket_id: string; status: string; amount_delta_minor: number; created_at: Date }>(
          `select ticket_id,status,amount_delta_minor,created_at from ticket_exchanges
            where ticket_id = any($1::text[]) order by created_at desc`,
          [ticketIds],
        ),
        query<{ participant_id: string; balance: number }>(
          `select participant_id,balance from score_projections where participant_id = any($1::text[])`,
          [participantIds],
        ),
        query<{ ticket_id: string; total: string; failed: string }>(
          `select context->>'ticketId' as ticket_id,count(*)::text as total,
                  count(*) filter (where status = 'failed')::text as failed
             from email_outbox
            where context->>'ticketId' = any($1::text[])
            group by context->>'ticketId'`,
          [ticketIds],
        ),
        query<{
          entity_id: string;
          action: string;
          actor_type: string;
          reason: string | null;
          created_at: Date;
        }>(
          `select entity_id,action,actor_type,reason,created_at from attendee_operations_audit_events
            where (entity_type = 'person' and entity_id = any($1::text[]))
               or (entity_type = 'ticket' and entity_id = any($2::text[]))
            order by created_at desc limit 100`,
          [ids, ticketIds],
        ),
      ])
    : [[], [], [], [], [], []];
  return people.map((person) => ({
    personId: person.id,
    canonicalName: person.canonical_name ?? undefined,
    verifiedEmails: emails
      .filter((email) => email.person_id === person.id && email.verified_at)
      .map((email) => email.display_hint),
    identities: emails
      .filter((email) => email.person_id === person.id)
      .map((email) => ({
        id: email.id,
        kind: "email" as const,
        masked: email.display_hint,
        status: email.verified_at
          ? ("verified" as const)
          : email.historical_until
            ? ("removed" as const)
            : ("pending" as const),
        verifiedAt: email.verified_at?.toISOString(),
        removedAt: email.historical_until?.toISOString(),
      })),
    access: {
      acquisitionStatus: person.acquisition_status,
      restrictedAt: person.acquisition_restricted_at?.toISOString(),
      restrictedBy: person.acquisition_restricted_by ?? undefined,
      restrictionReason: person.acquisition_restriction_reason ?? undefined,
      activeSessions: sessions.get(person.id)?.activeSessions ?? 0,
      lastSeenAt: sessions.get(person.id)?.lastSeenAt,
      authenticatedAt: sessions.get(person.id)?.authenticatedAt,
    },
    tickets: tickets
      .filter((ticket) => ticket.person_id === person.id)
      .map((ticket) => ({
        id: ticket.id,
        eventSlug: ticket.event_slug,
        eventTitle: ticket.event_title,
        holderName: ticket.holder_name,
        status: ticket.status,
        orderId: ticket.order_id,
        participantId: ticket.participant_id,
        checkedInAt: ticket.checked_in_at?.toISOString(),
        amountPaidMinor: ticket.amount_paid_minor ?? undefined,
        currency: ticket.currency ?? undefined,
        supportNote: ticket.notes ?? undefined,
        otherOrderTickets: Number(ticket.other_order_tickets) || 0,
        scoreBalance:
          scores.find((score) => score.participant_id === ticket.participant_id)?.balance ?? 0,
        transferHistory: transfers
          .filter((transfer) => transfer.ticket_id === ticket.id)
          .map((transfer) => ({
            status: transfer.status,
            recipientEmailHint: transfer.recipient_email_hint,
            createdAt: transfer.created_at.toISOString(),
          })),
        returnHistory: returns
          .filter((request) => request.ticket_id === ticket.id)
          .map((request) => ({
            status: request.status,
            amountMinor: request.amount_minor ?? undefined,
            currency: request.currency ?? undefined,
            createdAt: request.created_at.toISOString(),
          })),
        exchanges: exchanges
          .filter((exchange) => exchange.ticket_id === ticket.id)
          .map((exchange) => ({
            status: exchange.status,
            amountDeltaMinor: exchange.amount_delta_minor,
            createdAt: exchange.created_at.toISOString(),
          })),
        communication: (() => {
          const row = communications.find((item) => item.ticket_id === ticket.id);
          return { total: Number(row?.total) || 0, failed: Number(row?.failed) || 0 };
        })(),
      })),
    globalRoles: globalRoles
      .filter((grant) => grant.person_id === person.id)
      .map((grant) => ({
        role: grant.role_preset,
        status: grant.status,
        expiresAt: grant.expires_at?.toISOString(),
      })),
    eventRoles: eventRoles
      .filter((grant) => grant.person_id === person.id)
      .map((grant) => ({
        eventSlug: grant.event_slug,
        label: grant.label,
        status: grant.status,
        expiresAt: grant.expires_at?.toISOString(),
      })),
    pendingInvitations: Number(invitations.find((row) => row.person_id === person.id)?.count) || 0,
    staffDevices: Number(devices.find((row) => row.person_id === person.id)?.count) || 0,
    auditTimeline: audit
      .filter(
        (event) =>
          event.entity_id === person.id ||
          tickets.some((ticket) => ticket.person_id === person.id && ticket.id === event.entity_id),
      )
      .map((event) => ({
        action: event.action,
        actorType: event.actor_type,
        reason: event.reason ?? undefined,
        createdAt: event.created_at.toISOString(),
      })),
  }));
}

/**
 * Purchases are contact records, not proof that the mailbox owner created an account.
 * Keep them discoverable to operators without manufacturing a verified identity at checkout.
 */
export async function searchPurchaserContacts(
  queryText: string,
  limit = 30,
): Promise<PurchaserContactDirectoryEntry[]> {
  const search = queryText.trim().toLocaleLowerCase("en-GB");
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const rows = await query<{
    email_hash: string;
    email: string;
    id: string;
    event_slug: string;
    event_title: string;
    holder_name: string;
    status: string;
    order_id: string;
    parent_ticket_id: string | null;
    issued_at: Date;
    delivery_status: string | null;
    delivery_needs_attention: boolean;
  }>(
    `with matching_contacts as (
       select ticket.email_hash,max(ticket.issued_at) as last_purchased_at
         from tickets ticket
        where ticket.email_hash is not null and ticket.email is not null
          and not exists (
            select 1 from event_person_identifiers identifier
             where identifier.kind = 'email' and identifier.value_hash = ticket.email_hash
               and identifier.verified_at is not null and identifier.historical_until is null
          )
          and ($1 = ''
            or lower(ticket.email) like '%' || $1 || '%'
            or lower(ticket.holder_name) like '%' || $1 || '%'
            or lower(ticket.id) like '%' || $1 || '%'
            or lower(ticket.event_slug) like '%' || $1 || '%'
            or lower(ticket.order_id) like '%' || $1 || '%')
        group by ticket.email_hash
        order by last_purchased_at desc
        limit $2
     )
     select ticket.email_hash,ticket.email,ticket.id,ticket.event_slug,event.title as event_title,
            ticket.holder_name,ticket.status,ticket.order_id,ticket.parent_ticket_id,ticket.issued_at,
            coalesce(delivery.provider_delivery_status,delivery.status) as delivery_status,
            coalesce(
              delivery.provider_delivery_status in ('bounced','failed','rejected','complained')
              or delivery.status = 'failed',
              false
            ) as delivery_needs_attention
       from matching_contacts contact
       join tickets ticket on ticket.email_hash = contact.email_hash
       join events event on event.slug = ticket.event_slug
       left join lateral (
         select outbox.provider_delivery_status,outbox.status
           from email_outbox outbox
          where outbox.context->>'orderId' = ticket.order_id
          order by outbox.created_at desc,outbox.id desc
          limit 1
       ) delivery on true
      order by contact.last_purchased_at desc,ticket.issued_at desc`,
    [search, boundedLimit],
  );
  const contacts = new Map<string, PurchaserContactDirectoryEntry>();
  for (const row of rows) {
    const current = contacts.get(row.email_hash);
    if (current) {
      current.tickets.push({
        id: row.id,
        eventSlug: row.event_slug,
        eventTitle: row.event_title,
        holderName: row.holder_name,
        status: row.status,
        orderId: row.order_id,
        issuedAt: row.issued_at.toISOString(),
        deliveryStatus: row.delivery_status ?? undefined,
        deliveryNeedsAttention: row.delivery_needs_attention,
      });
      if (!current.name && !row.parent_ticket_id) current.name = row.holder_name;
      continue;
    }
    contacts.set(row.email_hash, {
      contactId: `purchaser:${row.email_hash}`,
      name: row.parent_ticket_id ? undefined : row.holder_name,
      emailHint: maskActionEmail(row.email),
      lastPurchasedAt: row.issued_at.toISOString(),
      tickets: [
        {
          id: row.id,
          eventSlug: row.event_slug,
          eventTitle: row.event_title,
          holderName: row.holder_name,
          status: row.status,
          orderId: row.order_id,
          issuedAt: row.issued_at.toISOString(),
          deliveryStatus: row.delivery_status ?? undefined,
          deliveryNeedsAttention: row.delivery_needs_attention,
        },
      ],
    });
  }
  return [...contacts.values()];
}
