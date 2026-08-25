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
  }>;
  globalRoles: Array<{ role: string; status: string; expiresAt?: string }>;
  eventRoles: Array<{ eventSlug: string; label: string; status: string; expiresAt?: string }>;
  pendingInvitations: number;
  staffDevices: number;
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
    }>(
      `select participant.person_id,ticket.id,ticket.event_slug,event.title as event_title,
              ticket.holder_name,ticket.status,ticket.order_id,participant.id as participant_id
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
  }));
}
