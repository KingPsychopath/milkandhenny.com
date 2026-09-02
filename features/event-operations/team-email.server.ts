import { createHash } from "node:crypto";

import { getEvent } from "@/features/events/store.server";
import { sendTicketEmail, type TicketTeamAssignment } from "@/features/tickets/email.server";
import { listTicketsForEvent } from "@/features/tickets/store.server";
import { ticketPublicId } from "@/features/tickets/types";
import { BASE_URL } from "@/lib/shared/config";
import { query } from "@/lib/platform/postgres.server";
import type { TeamColourKey } from "@/lib/shared/team-palette";

type TeamTicketRow = {
  ticket_id: string;
  team_id: string;
  team_name: string;
  colour_key: TeamColourKey;
};

/**
 * Queue one current team card per ticket order.
 *
 * The allocation digest makes repeated taps harmless while allowing a later
 * reshuffle to send the genuinely new assignments.
 */
export async function sendEventTeamEmails(input: {
  eventSlug: string;
  actorId: string;
  deviceId: string;
}) {
  const [event, tickets, assignments] = await Promise.all([
    getEvent(input.eventSlug),
    listTicketsForEvent(input.eventSlug),
    query<TeamTicketRow>(
      `select participants.ticket_id, teams.id as team_id, teams.name as team_name,
              teams.colour_key
         from event_participants participants
         join score_team_memberships memberships
           on memberships.participant_id = participants.id
          and memberships.starts_at <= now()
          and (memberships.ends_at is null or memberships.ends_at > now())
         join score_teams teams on teams.id = memberships.team_id
        where participants.event_slug = $1
          and participants.status = 'active'
          and participants.ticket_id is not null
          and teams.status = 'active'
          and teams.colour_key is not null`,
      [input.eventSlug],
    ),
  ]);
  if (!event) return { ok: false as const, status: 404, error: "Event not found" };

  const assignmentByTicket = new Map(assignments.map((row) => [row.ticket_id, row]));
  const orders = Map.groupBy(
    tickets.filter((ticket) => ticket.status === "valid" && assignmentByTicket.has(ticket.id)),
    (ticket) => ticket.orderId,
  );
  let queued = 0;
  let unchanged = 0;
  let skippedNoEmail = 0;

  for (const [orderId, orderTickets] of orders) {
    if (!orderTickets.some((ticket) => ticket.email)) {
      skippedNoEmail += 1;
      continue;
    }
    const teams: Record<string, TicketTeamAssignment> = {};
    const allocation = orderTickets
      .flatMap((ticket) => {
        const assigned = assignmentByTicket.get(ticket.id);
        if (!assigned) return [];
        const team = { name: assigned.team_name, colourKey: assigned.colour_key };
        teams[ticket.id] = team;
        teams[ticketPublicId(ticket)] = team;
        return [`${ticket.id}:${assigned.team_id}`];
      })
      .toSorted();
    const digest = createHash("sha256").update(allocation.join("|")).digest("hex").slice(0, 20);
    const result = await sendTicketEmail({
      event,
      tickets: orderTickets,
      origin: BASE_URL,
      kind: "event-team",
      source: "admin",
      idempotencyKey: `event-team:${input.eventSlug}:${orderId}:${digest}`,
      subject: `Your team — ${event.title}`,
      teams,
    });
    if (result.queued && result.alreadyRequested) unchanged += 1;
    else if (result.queued) queued += 1;
  }

  await query(
    `insert into score_audit_events
       (event_slug,action,actor_type,actor_id,assignment_id,device_id,
        entity_type,entity_id,metadata)
     values ($1,'teams.emailed','staff',$2,$2,$3,'event',$1,$4::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      input.deviceId,
      JSON.stringify({ queued, unchanged, skippedNoEmail, orderCount: orders.size }),
    ],
  );
  return {
    ok: true as const,
    value: { queued, unchanged, skippedNoEmail, orderCount: orders.size },
  };
}
