import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { isTeamCount, teamPaletteForCount, type TeamColourKey } from "../team-palette";
import type { ScoreParticipant, ScoreProjection, ScoreTeam, ScoreTeamMembership } from "../types";
import { id, toParticipant, type ParticipantRow, type ScoreStoreResult } from "./common.server";

export async function createTeam(input: {
  eventSlug: string;
  name: string;
}): Promise<ScoreStoreResult<ScoreTeam>> {
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: "Name the team" };
  if (name.length > 120)
    return { ok: false, status: 400, error: "Use 120 characters or fewer for a team name" };
  const row = await queryOne<{
    id: string;
    event_slug: string;
    name: string;
    colour_key: TeamColourKey | null;
    sort_order: number | null;
    status: string;
  }>(
    `insert into score_teams (id, event_slug, name)
     values ($1,$2,$3)
     returning id, event_slug, name, colour_key, sort_order, status`,
    [id("team"), input.eventSlug, name],
  );
  if (!row) return { ok: false, status: 500, error: "Team could not be created" };
  return {
    ok: true,
    value: {
      id: row.id,
      eventSlug: row.event_slug,
      name: row.name,
      colourKey: row.colour_key ?? undefined,
      sortOrder: row.sort_order ?? undefined,
      memberCount: 0,
      checkedInCount: 0,
      status: row.status as ScoreTeam["status"],
    },
  };
}

export async function listTeams(eventSlug: string): Promise<ScoreTeam[]> {
  const rows = await query<{
    id: string;
    event_slug: string;
    name: string;
    colour_key: TeamColourKey | null;
    sort_order: number | null;
    member_count: number;
    checked_in_count: number;
    status: string;
  }>(
    `select teams.id, teams.event_slug, teams.name, teams.colour_key, teams.sort_order, teams.status,
            count(participants.id) filter (where participants.status = 'active')::integer
              as member_count,
            count(participants.id) filter (where participants.checked_in_at is not null
              and participants.status = 'active')::integer as checked_in_count
       from score_teams teams
       left join score_team_memberships memberships
         on memberships.team_id = teams.id
        and memberships.starts_at <= now()
        and (memberships.ends_at is null or memberships.ends_at > now())
       left join event_participants participants on participants.id = memberships.participant_id
      where teams.event_slug = $1
      group by teams.id
      order by teams.status = 'active' desc, teams.sort_order nulls last,
               teams.created_at, teams.name, teams.id`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: row.id,
    eventSlug: row.event_slug,
    name: row.name,
    colourKey: row.colour_key ?? undefined,
    sortOrder: row.sort_order ?? undefined,
    memberCount: row.member_count,
    checkedInCount: row.checked_in_count,
    status: row.status as ScoreTeam["status"],
  }));
}

export type CheckedInTeamParticipant = {
  id: string;
  publicAlias: string;
  displayName?: string;
  ticketSuffix?: string;
  teamId?: string;
  teamName?: string;
  teamColourKey?: TeamColourKey;
  checkedIn: boolean;
};

export async function listCheckedInTeamParticipants(
  eventSlug: string,
): Promise<CheckedInTeamParticipant[]> {
  const rows = await query<{
    id: string;
    generated_alias: string;
    chosen_alias: string | null;
    display_name: string | null;
    holder_name: string | null;
    ticket_id: string | null;
    team_id: string | null;
    team_name: string | null;
    team_colour_key: TeamColourKey | null;
    checked_in_at: Date | null;
  }>(
    `select participants.id, participants.generated_alias, participants.chosen_alias,
            participants.display_name, tickets.holder_name, participants.ticket_id,
            team.team_id, team.team_name, team.team_colour_key,
            participants.checked_in_at
       from event_participants participants
       left join tickets on tickets.id = participants.ticket_id
       left join lateral (
         select memberships.team_id, teams.name as team_name,
                teams.colour_key as team_colour_key
           from score_team_memberships memberships
           join score_teams teams on teams.id = memberships.team_id
          where memberships.participant_id = participants.id
            and memberships.starts_at <= now()
            and (memberships.ends_at is null or memberships.ends_at > now())
          order by memberships.starts_at desc limit 1
       ) team on true
      where participants.event_slug = $1
        and participants.status = 'active'
        and tickets.status = 'valid'
      order by team.team_name nulls last,
               coalesce(participants.display_name, tickets.holder_name,
                        participants.chosen_alias, participants.generated_alias), participants.id`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: row.id,
    publicAlias: row.chosen_alias ?? row.generated_alias,
    displayName: row.display_name ?? row.holder_name ?? undefined,
    ticketSuffix: row.ticket_id?.slice(-8),
    teamId: row.team_id ?? undefined,
    teamName: row.team_name ?? undefined,
    teamColourKey: row.team_colour_key ?? undefined,
    checkedIn: row.checked_in_at !== null,
  }));
}

export async function shuffleCheckedInTeams(input: {
  eventSlug: string;
  teamCount: number;
  actorType: "admin" | "staff";
  actorId: string;
  assignmentId?: string;
  deviceId?: string;
}): Promise<ScoreStoreResult<{ teams: ScoreTeam[]; assignedCount: number }>> {
  if (!isTeamCount(input.teamCount)) {
    return { ok: false, status: 400, error: "Choose 2, 3, or 4 teams" };
  }
  const teamCount = input.teamCount;
  const result = await transaction(async (client) => {
    const event = await client.query<{ slug: string }>(
      `select slug from events where slug = $1 for update`,
      [input.eventSlug],
    );
    if (!event.rows[0]) return { ok: false as const, status: 404, error: "Event not found" };
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [input.eventSlug]);

    const stored = await client.query<{
      id: string;
      name: string;
      created_at: Date;
    }>(
      `select id, name, created_at from score_teams
        where event_slug = $1
        order by status = 'active' desc, sort_order nulls last, created_at, id
        for update`,
      [input.eventSlug],
    );
    const palette = teamPaletteForCount(teamCount);
    const selected = stored.rows.slice(0, teamCount);
    while (selected.length < teamCount) {
      const slot = selected.length;
      const created = await client.query<{ id: string; name: string; created_at: Date }>(
        `insert into score_teams (id,event_slug,name,status,colour_key,sort_order)
         values ($1,$2,$3,'active',$4,$5)
         returning id,name,created_at`,
        [id("team"), input.eventSlug, palette[slot]!.defaultName, palette[slot]!.colourKey, slot],
      );
      selected.push(created.rows[0]!);
    }
    for (const [slot, team] of selected.entries()) {
      await client.query(
        `update score_teams
            set status = 'active', colour_key = $3, sort_order = $4
          where id = $1 and event_slug = $2`,
        [team.id, input.eventSlug, palette[slot]!.colourKey, slot],
      );
    }
    const selectedIds = selected.map((team) => team.id);
    await client.query(
      `update score_teams set status = 'archived', sort_order = null
        where event_slug = $1 and not (id = any($2::text[]))`,
      [input.eventSlug, selectedIds],
    );

    const participants = await client.query<{ id: string }>(
      `select participants.id from event_participants participants
        join tickets on tickets.id = participants.ticket_id
        where participants.event_slug = $1
          and participants.status = 'active'
          and tickets.status = 'valid'
        order by random(), participants.id for update of participants`,
      [input.eventSlug],
    );
    const timestamp = (await client.query<{ at: Date }>(`select clock_timestamp() as at`)).rows[0]!
      .at;
    await client.query(
      `update score_team_memberships memberships
          set ends_at = $2
        where memberships.event_slug = $1 and memberships.ends_at is null
          and memberships.starts_at < $2
          and exists (
            select 1 from event_participants participants
             where participants.id = memberships.participant_id
               and participants.status = 'active'
          )`,
      [input.eventSlug, timestamp],
    );
    for (const [index, participant] of participants.rows.entries()) {
      await client.query(
        `insert into score_team_memberships
           (id,event_slug,team_id,participant_id,starts_at)
         values ($1,$2,$3,$4,$5)`,
        [
          id("tm"),
          input.eventSlug,
          selectedIds[index % selectedIds.length]!,
          participant.id,
          timestamp,
        ],
      );
    }
    await client.query(
      `insert into score_audit_events
         (event_slug,action,actor_type,actor_id,assignment_id,device_id,
          entity_type,entity_id,metadata)
       values ($1,'teams.shuffled',$2,$3,$4,$5,'event',$1,$6::jsonb)`,
      [
        input.eventSlug,
        input.actorType,
        input.actorId,
        input.assignmentId ?? null,
        input.deviceId ?? null,
        JSON.stringify({
          teamCount,
          teamIds: selectedIds,
          assignedCount: participants.rowCount ?? 0,
        }),
      ],
    );
    return { ok: true as const, assignedCount: participants.rowCount ?? 0 };
  });
  if (!result.ok) return result;
  return {
    ok: true,
    value: { teams: await listTeams(input.eventSlug), assignedCount: result.assignedCount },
  };
}

export async function listTeamLeaderboardTotals(eventSlug: string) {
  const rows = await query<{
    id: string;
    name: string;
    colour_key: TeamColourKey | null;
    points: number;
  }>(
    `select teams.id, teams.name, teams.colour_key,
            coalesce(sum(postings.points) filter (where transactions.status = 'accepted'), 0)::integer as points
       from score_teams teams
       left join score_postings postings on postings.team_id = teams.id
       left join score_transactions transactions on transactions.id = postings.transaction_id
      where teams.event_slug = $1 and teams.status = 'active'
      group by teams.id
      order by points desc, teams.sort_order nulls last, teams.name, teams.id`,
    [eventSlug],
  );
  return rows.map((row, index, all) => ({
    id: row.id,
    name: row.name,
    colourKey: row.colour_key ?? undefined,
    points: row.points,
    rank: all.findIndex((candidate) => candidate.points === row.points) + 1 || index + 1,
  }));
}

export async function setTeamMembership(input: {
  eventSlug: string;
  teamId: string;
  participantId: string;
  startsAt?: string;
}): Promise<ScoreStoreResult<ScoreTeamMembership>> {
  if (input.startsAt && Number.isNaN(Date.parse(input.startsAt)))
    return { ok: false, status: 400, error: "Team assignment start must be a valid time" };
  try {
    return await transaction(async (client) => {
      const participant = await client.query<{ id: string }>(
        `select id from event_participants where id = $1 and event_slug = $2 for update`,
        [input.participantId, input.eventSlug],
      );
      const team = await client.query<{ id: string }>(
        `select id from score_teams where id = $1 and event_slug = $2 for update`,
        [input.teamId, input.eventSlug],
      );
      if (!participant.rows[0] || !team.rows[0])
        return { ok: false, status: 404, error: "Team or participant not found" };
      const startsAt =
        (input.startsAt ? new Date(input.startsAt).toISOString() : undefined) ??
        (
          await client.query<{ starts_at: Date }>(`select clock_timestamp() as starts_at`)
        ).rows[0]!.starts_at.toISOString();
      await client.query(
        `update score_team_memberships
            set ends_at = $3
          where event_slug = $1 and participant_id = $2 and ends_at is null and starts_at < $3`,
        [input.eventSlug, input.participantId, startsAt],
      );
      const row = await client.query<{
        id: string;
        event_slug: string;
        team_id: string;
        participant_id: string;
        starts_at: Date;
        ends_at: Date | null;
      }>(
        `insert into score_team_memberships (id, event_slug, team_id, participant_id, starts_at)
         values ($1,$2,$3,$4,$5)
         returning id, event_slug, team_id, participant_id, starts_at, ends_at`,
        [id("tm"), input.eventSlug, input.teamId, input.participantId, startsAt],
      );
      const membership = row.rows[0];
      if (!membership)
        return { ok: false, status: 500, error: "Team membership could not be created" };
      return {
        ok: true,
        value: {
          id: membership.id,
          eventSlug: membership.event_slug,
          teamId: membership.team_id,
          participantId: membership.participant_id,
          startsAt: membership.starts_at.toISOString(),
          endsAt: membership.ends_at?.toISOString(),
        },
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("score_team_memberships")) {
      return { ok: false, status: 409, error: "That team membership overlaps an existing period" };
    }
    throw error;
  }
}

export async function privateOrderScore(input: {
  eventSlug: string;
  orderId: string;
}): Promise<
  ScoreStoreResult<{ points: number; participants: { participantId: string; points: number }[] }>
> {
  const rows = await query<{ participant_id: string; points: string }>(
    `select p.id as participant_id, coalesce(sum(case when t.status = 'accepted' then sp.points else 0 end), 0)::text as points
       from tickets tk
       join event_participants p on p.ticket_id = tk.id
       left join score_postings sp on sp.participant_id = p.id
       left join score_transactions t on t.id = sp.transaction_id
      where tk.event_slug = $1 and tk.order_id = $2
      group by p.id
      order by p.id`,
    [input.eventSlug, input.orderId],
  );
  return {
    ok: true,
    value: {
      points: rows.reduce((sum, row) => sum + Number(row.points), 0),
      participants: rows.map((row) => ({
        participantId: row.participant_id,
        points: Number(row.points),
      })),
    },
  };
}

export async function participantForTicket(
  ticketId: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string }) | null> {
  const row = await queryOne<ParticipantRow>(
    `select p.*, people.canonical_name, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id, tm.team_name, tm.team_colour_key
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name, t.colour_key as team_colour_key
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.ticket_id = $1`,
    [ticketId],
  );
  return row ? toParticipant(row) : null;
}

export async function getParticipant(
  participantId: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string }) | null> {
  const row = await queryOne<ParticipantRow>(
    `select p.*, people.canonical_name, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id, tm.team_name, tm.team_colour_key
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name, t.colour_key as team_colour_key
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.id = $1`,
    [participantId],
  );
  return row ? toParticipant(row) : null;
}

/** Active ticket-backed participants that a verified person can recover on another device. */
export async function ticketParticipantsForPerson(
  personId: string,
): Promise<Array<{ id: string; eventSlug: string; ticketId: string }>> {
  if (!personId) return [];
  const rows = await query<{ id: string; event_slug: string; ticket_id: string }>(
    `select participants.id, participants.event_slug, participants.ticket_id
       from event_participants participants
       join tickets on tickets.id = participants.ticket_id
      where participants.person_id = $1
        and participants.status = 'active'
        and tickets.status = 'valid'
      order by participants.created_at, participants.id`,
    [personId],
  );
  return rows.map((row) => ({
    id: row.id,
    eventSlug: row.event_slug,
    ticketId: row.ticket_id,
  }));
}

export async function listLeaderboardParticipants(
  eventSlug: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string })[]> {
  const rows = await query<ParticipantRow>(
    `select p.*, people.canonical_name, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id, tm.team_name, tm.team_colour_key
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name, t.colour_key as team_colour_key
           from score_team_memberships m
           left join score_teams t on t.id = m.team_id
          where m.participant_id = p.id
            and m.starts_at <= now()
            and (m.ends_at is null or m.ends_at > now())
          order by m.starts_at desc limit 1
       ) tm on true
      where p.event_slug = $1
        and p.status not in ('void', 'merged')
        and p.display_mode <> 'hidden'
      order by balance desc, coalesce(p.chosen_alias, p.generated_alias), p.id`,
    [eventSlug],
  );
  return rows.map(toParticipant);
}

export async function updateParticipantPublicIdentity(input: {
  eventSlug: string;
  participantId: string;
  displayMode: ScoreParticipant["displayMode"];
  /** `undefined` preserves the choice; `null` returns to the generated alias. */
  publicAlias?: string | null;
}): Promise<
  ScoreStoreResult<{ publicAlias: string; displayMode: ScoreParticipant["displayMode"] }>
> {
  const alias = input.publicAlias?.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (input.displayMode === "alias" && alias !== undefined) {
    if (alias.length < 2 || alias.length > 40)
      return { ok: false, status: 400, error: "An alias must use 2 to 40 characters" };
    if (/[@<>\p{Cc}]/u.test(alias))
      return { ok: false, status: 400, error: "That alias contains unsupported characters" };
    if (/^(guest|player|removed)-[0-9a-f]+$/iu.test(alias))
      return { ok: false, status: 400, error: "That alias is reserved" };
  }
  try {
    const row = await queryOne<{
      generated_alias: string;
      chosen_alias: string | null;
      display_mode: ScoreParticipant["displayMode"];
    }>(
      `update event_participants
          set chosen_alias = case when $4 then $5 else chosen_alias end,
              display_mode = $3, updated_at = now()
        where id = $1 and event_slug = $2 and status = 'active'
        returning generated_alias, chosen_alias, display_mode`,
      [
        input.participantId,
        input.eventSlug,
        input.displayMode,
        input.publicAlias !== undefined,
        alias ?? null,
      ],
    );
    if (!row) return { ok: false, status: 404, error: "Participant not found" };
    return {
      ok: true,
      value: {
        publicAlias: row.chosen_alias ?? row.generated_alias,
        displayMode: row.display_mode,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("event_participants_chosen_alias_idx"))
      return { ok: false, status: 409, error: "That public alias is already in use" };
    throw error;
  }
}

export async function searchEventParticipants(
  eventSlug: string,
  term: string,
  limit = 20,
  includeEmail = false,
): Promise<
  Array<{
    id: string;
    publicAlias: string;
    displayName?: string;
    ticketSuffix?: string;
    balance: number;
    checkedIn: boolean;
    teamName?: string;
    email?: string;
    orderSize: number;
    orderPoints: number;
  }>
> {
  const normalized = term.trim();
  if (normalized.length < 2) return [];
  const rows = await query<{
    id: string;
    generated_alias: string;
    chosen_alias: string | null;
    display_name: string | null;
    holder_name: string | null;
    ticket_id: string | null;
    balance: number;
    checked_in_at: Date | null;
    team_name: string | null;
    email: string | null;
    order_size: number;
    order_points: number;
  }>(
    `select participants.id, participants.generated_alias, participants.chosen_alias,
            participants.display_name, tickets.holder_name,
            participants.ticket_id, coalesce(projections.balance, 0)::integer as balance,
            participants.checked_in_at, team.team_name, tickets.email,
            coalesce(ticket_order.size, 1)::integer as order_size,
            coalesce(ticket_order.points, coalesce(projections.balance, 0))::integer as order_points
       from event_participants participants
       left join score_projections projections on projections.participant_id = participants.id
       left join tickets on tickets.id = participants.ticket_id
       left join lateral (
         select count(*)::integer as size,
                coalesce(sum(order_projection.balance), 0)::integer as points
           from tickets order_ticket
           join event_participants order_participant on order_participant.ticket_id = order_ticket.id
           left join score_projections order_projection
             on order_projection.participant_id = order_participant.id
          where order_ticket.order_id = tickets.order_id
            and order_ticket.event_slug = participants.event_slug
            and order_ticket.status = 'valid'
            and order_participant.status = 'active'
       ) ticket_order on true
       left join lateral (
         select score_teams.name as team_name
           from score_team_memberships membership
           join score_teams on score_teams.id = membership.team_id
          where membership.participant_id = participants.id
            and membership.starts_at <= now()
            and (membership.ends_at is null or membership.ends_at > now())
          order by membership.starts_at desc limit 1
       ) team on true
      where participants.event_slug = $1
        and participants.status = 'active'
        and (
          participants.generated_alias ilike '%' || $2 || '%'
          or coalesce(participants.chosen_alias, '') ilike '%' || $2 || '%'
          or coalesce(participants.display_name, '') ilike '%' || $2 || '%'
          or coalesce(tickets.holder_name, '') ilike '%' || $2 || '%'
          or right(coalesce(participants.ticket_id, ''), 8) ilike '%' || $2 || '%'
        )
      order by
        case when lower(coalesce(participants.display_name, tickets.holder_name,
                                 participants.chosen_alias,
                                 participants.generated_alias)) = lower($2)
          then 0 else 1 end,
        coalesce(participants.display_name, tickets.holder_name, participants.chosen_alias,
                 participants.generated_alias), participants.id
      limit $3`,
    [eventSlug, normalized, Math.min(Math.max(limit, 1), 30)],
  );
  return rows.map((row) => ({
    id: row.id,
    publicAlias: row.chosen_alias ?? row.generated_alias,
    displayName: row.display_name ?? row.holder_name ?? undefined,
    ticketSuffix: row.ticket_id?.slice(-8),
    balance: row.balance,
    checkedIn: row.checked_in_at !== null,
    teamName: row.team_name ?? undefined,
    email: includeEmail ? (row.email ?? undefined) : undefined,
    orderSize: row.order_size,
    orderPoints: row.order_points,
  }));
}

export async function participantIdsInTicketOrder(
  eventSlug: string,
  participantId: string,
): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select order_participant.id
       from event_participants selected_participant
       join tickets selected_ticket on selected_ticket.id = selected_participant.ticket_id
       join tickets order_ticket on order_ticket.order_id = selected_ticket.order_id
       join event_participants order_participant on order_participant.ticket_id = order_ticket.id
      where selected_participant.id = $1
        and selected_participant.event_slug = $2
        and order_participant.event_slug = $2
        and order_ticket.event_slug = $2
        and order_participant.status = 'active'
        and order_ticket.status = 'valid'
      order by order_ticket.issued_at, order_ticket.id`,
    [participantId, eventSlug],
  );
  return rows.map((row) => row.id);
}

export async function ticketOrderSummaryForParticipant(
  eventSlug: string,
  participantId: string,
): Promise<{ orderSize: number; orderPoints: number }> {
  const row = await queryOne<{ order_size: number; order_points: number }>(
    `select count(*)::integer as order_size,
            coalesce(sum(order_projection.balance), 0)::integer as order_points
       from event_participants selected_participant
       join tickets selected_ticket on selected_ticket.id = selected_participant.ticket_id
       join tickets order_ticket on order_ticket.order_id = selected_ticket.order_id
       join event_participants order_participant on order_participant.ticket_id = order_ticket.id
       left join score_projections order_projection
         on order_projection.participant_id = order_participant.id
      where selected_participant.id = $1
        and selected_participant.event_slug = $2
        and order_ticket.event_slug = $2
        and order_participant.status = 'active'
        and order_ticket.status = 'valid'`,
    [participantId, eventSlug],
  );
  return { orderSize: row?.order_size ?? 1, orderPoints: row?.order_points ?? 0 };
}
