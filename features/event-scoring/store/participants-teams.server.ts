import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import type { ScoreParticipant, ScoreProjection, ScoreTeam, ScoreTeamMembership } from "../types";
import { id, toParticipant, type ParticipantRow, type ScoreStoreResult } from "./common.server";

export async function createTeam(input: {
  eventSlug: string;
  name: string;
}): Promise<ScoreStoreResult<ScoreTeam>> {
  if (!input.name.trim()) return { ok: false, status: 400, error: "Name the team" };
  const row = await queryOne<{ id: string; event_slug: string; name: string; status: string }>(
    `insert into score_teams (id, event_slug, name)
     values ($1,$2,$3)
     returning id, event_slug, name, status`,
    [id("team"), input.eventSlug, input.name.trim()],
  );
  if (!row) return { ok: false, status: 500, error: "Team could not be created" };
  return {
    ok: true,
    value: {
      id: row.id,
      eventSlug: row.event_slug,
      name: row.name,
      status: row.status as ScoreTeam["status"],
    },
  };
}

export async function listTeams(eventSlug: string): Promise<ScoreTeam[]> {
  const rows = await query<{ id: string; event_slug: string; name: string; status: string }>(
    `select id, event_slug, name, status from score_teams where event_slug = $1 order by name, id`,
    [eventSlug],
  );
  return rows.map((row) => ({
    id: row.id,
    eventSlug: row.event_slug,
    name: row.name,
    status: row.status as ScoreTeam["status"],
  }));
}

export async function setTeamMembership(input: {
  eventSlug: string;
  teamId: string;
  participantId: string;
  startsAt?: string;
}): Promise<ScoreStoreResult<ScoreTeamMembership>> {
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
        input.startsAt ??
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
            tm.team_id
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
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
            tm.team_id
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
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

export async function listLeaderboardParticipants(
  eventSlug: string,
): Promise<(ScoreParticipant & ScoreProjection & { teamId?: string })[]> {
  const rows = await query<ParticipantRow>(
    `select p.*, people.canonical_name, coalesce(sp.balance, 0)::integer as balance,
            coalesce(sp.revision, 0)::bigint as projection_revision,
            sp.last_transaction_at,
            tm.team_id
       from event_participants p
       left join event_people people on people.id = p.person_id
       left join score_projections sp on sp.participant_id = p.id
       left join lateral (
         select m.team_id, t.name as team_name
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
    email?: string;
  }>
> {
  const normalized = term.trim();
  if (normalized.length < 2) return [];
  const rows = await query<{
    id: string;
    generated_alias: string;
    chosen_alias: string | null;
    display_name: string | null;
    ticket_id: string | null;
    balance: number;
    checked_in_at: Date | null;
    email: string | null;
  }>(
    `select participants.id, participants.generated_alias, participants.chosen_alias,
            participants.display_name,
            participants.ticket_id, coalesce(projections.balance, 0)::integer as balance,
            participants.checked_in_at, tickets.email
       from event_participants participants
       left join score_projections projections on projections.participant_id = participants.id
       left join tickets on tickets.id = participants.ticket_id
      where participants.event_slug = $1
        and participants.status = 'active'
        and (
          participants.generated_alias ilike '%' || $2 || '%'
          or coalesce(participants.chosen_alias, '') ilike '%' || $2 || '%'
          or coalesce(participants.display_name, '') ilike '%' || $2 || '%'
          or right(coalesce(participants.ticket_id, ''), 8) ilike '%' || $2 || '%'
        )
      order by
        case when lower(coalesce(participants.display_name, participants.chosen_alias,
                                 participants.generated_alias)) = lower($2)
          then 0 else 1 end,
        coalesce(participants.display_name, participants.chosen_alias,
                 participants.generated_alias), participants.id
      limit $3`,
    [eventSlug, normalized, Math.min(Math.max(limit, 1), 30)],
  );
  return rows.map((row) => ({
    id: row.id,
    publicAlias: row.chosen_alias ?? row.generated_alias,
    displayName: row.display_name ?? undefined,
    ticketSuffix: row.ticket_id?.slice(-8),
    balance: row.balance,
    checkedIn: row.checked_in_at !== null,
    email: includeEmail ? (row.email ?? undefined) : undefined,
  }));
}
