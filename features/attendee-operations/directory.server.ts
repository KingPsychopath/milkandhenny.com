import { query } from "@/lib/platform/postgres.server";

export type PersonDirectoryEntry = {
  personId: string;
  canonicalName?: string;
  verifiedEmails: string[];
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
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const people = await query<{ id: string; canonical_name: string | null }>(
    `select distinct person.id,person.canonical_name
       from event_people person
       left join event_person_identifiers identifier on identifier.person_id = person.id
       left join event_participants participant on participant.person_id = person.id
       left join tickets ticket on ticket.id = participant.ticket_id
      where $1 = ''
         or lower(coalesce(person.canonical_name,'')) like '%' || $1 || '%'
         or lower(person.id) like '%' || $1 || '%'
         or lower(coalesce(identifier.display_hint,'')) like '%' || $1 || '%'
         or lower(coalesce(ticket.id,'')) like '%' || $1 || '%'
         or lower(coalesce(ticket.event_slug,'')) like '%' || $1 || '%'
      order by person.canonical_name nulls last,person.id
      limit $2`,
    [search, boundedLimit],
  );
  if (!people.length) return [];
  const ids = people.map((person) => person.id);
  const [emails, tickets, globalRoles, eventRoles, invitations, devices] = await Promise.all([
    query<{ person_id: string; display_hint: string }>(
      `select person_id,coalesce(display_hint,'verified email') as display_hint
         from event_person_identifiers
        where person_id = any($1::text[]) and kind = 'email' and verified_at is not null
        order by verified_at desc`,
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
      `select participant.person_id,ticket.id,ticket.event_slug,event.title as event_title,
              ticket.holder_name,ticket.status,ticket.order_id,participant.id as participant_id,
              participant.checked_in_at,ticket.amount_paid_minor,ticket.currency,ticket.notes,
              (select count(*) - 1 from tickets sibling where sibling.order_id = ticket.order_id)::text as other_order_tickets
         from event_participants participant
         join tickets ticket on ticket.id = participant.ticket_id
         join events event on event.slug = ticket.event_slug
        where participant.person_id = any($1::text[])
        order by event.starts_at desc,ticket.issued_at`,
      [ids],
    ),
    query<{ person_id: string; role_preset: string; status: string; expires_at: Date | null }>(
      `select person_id,role_preset,status,expires_at from global_admin_grants
        where person_id = any($1::text[]) order by created_at desc`,
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
        where person_id = any($1::text[]) order by created_at desc`,
      [ids],
    ),
    query<{ person_id: string; count: string }>(
      `select person_id,count(*)::text as count from (
         select purchaser_person_id as person_id from ticket_assignments where status = 'pending'
         union all select sender_person_id from ticket_transfers where status = 'pending'
       ) pending where person_id = any($1::text[]) group by person_id`,
      [ids],
    ),
    query<{ person_id: string; count: string }>(
      `select assignment.person_id,count(device.device_id)::text as count
         from score_staff_assignments assignment
         join score_staff_devices device on device.assignment_id = assignment.id and device.revoked_at is null
        where assignment.person_id = any($1::text[])
        group by assignment.person_id`,
      [ids],
    ),
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
      .filter((email) => email.person_id === person.id)
      .map((email) => email.display_hint),
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
