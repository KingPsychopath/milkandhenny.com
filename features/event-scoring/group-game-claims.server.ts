import { createHash, randomBytes } from "node:crypto";

import { queryOne, transaction } from "@/lib/platform/postgres.server";
import { mergeParticipantsInTransaction } from "./scoring.server";
import type { OfficialGameKind } from "@/features/game-results/types";

const SESSION_LIFETIME_MS = 10 * 60 * 1_000;

type GroupClaimSessionRow = {
  id: string;
  official_result_id: string;
  event_slug: string;
  game_kind: OfficialGameKind;
  game_instance_id: string;
  group_key: string;
  group_name: string;
  maximum_claims: number;
  status: "active" | "closed" | "expired";
  expires_at: Date | string;
  claimed: number;
  points: number;
};

export type GroupGameClaimSession = {
  id: string;
  eventSlug: string;
  gameKind: OfficialGameKind;
  gameInstanceId: string;
  groupKey: string;
  groupName: string;
  maximumClaims: number;
  claimed: number;
  points: number;
  status: "active" | "closed" | "expired";
  expiresAt: number;
};

type GroupClaimFailure = { ok: false; status: number; error: string };

function id(prefix: "gcs" | "gcc") {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toSession(row: GroupClaimSessionRow): GroupGameClaimSession {
  const expiresAt = new Date(row.expires_at).getTime();
  const status = row.status === "active" && expiresAt <= Date.now() ? "expired" : row.status;
  return {
    id: row.id,
    eventSlug: row.event_slug,
    gameKind: row.game_kind,
    gameInstanceId: row.game_instance_id,
    groupKey: row.group_key,
    groupName: row.group_name,
    maximumClaims: row.maximum_claims,
    claimed: Number(row.claimed),
    points: Number(row.points),
    status,
    expiresAt,
  };
}

const SESSION_SELECT = `
  select sessions.id, sessions.official_result_id, sessions.event_slug,
         results.game_kind, results.game_instance_id,
         sessions.group_key, sessions.group_name, sessions.maximum_claims,
         sessions.status, sessions.expires_at,
         (select count(*)::integer from game_result_group_claims claims
           where claims.session_id = sessions.id and claims.state = 'accepted') as claimed,
         coalesce(
           (select claims.points_awarded from game_result_group_claims claims
             where claims.session_id = sessions.id and claims.state = 'accepted'
             order by claims.accepted_at desc limit 1),
           (select coalesce(sum(postings.points), 0)::integer
              from event_game_player_links links
              join event_participants participants on participants.id = links.participant_id
              join score_postings postings on postings.participant_id = participants.id
              join score_transactions transactions on transactions.id = postings.transaction_id
             where links.channel_id = results.channel_id
               and left(links.game_player_id, char_length(sessions.game_player_prefix)) = sessions.game_player_prefix
               and transactions.status = 'accepted'
             group by links.game_player_id
             order by links.game_player_id limit 1),
           0
         )::integer as points
    from game_result_group_claim_sessions sessions
    join official_game_results results on results.id = sessions.official_result_id`;

export async function openGroupGameClaimSession(input: {
  gameKind: OfficialGameKind;
  gameInstanceId: string;
  resultId: string;
  groupKey: string;
  groupName: string;
  gamePlayerPrefix: string;
  maximumClaims: number;
}): Promise<
  { ok: true; value: { token: string; session: GroupGameClaimSession } } | GroupClaimFailure
> {
  const token = randomBytes(30).toString("base64url");
  return transaction(async (client) => {
    const result = await client.query<{
      id: string;
      event_slug: string;
      channel_id: string;
      available_slots: number;
    }>(
      `select results.id, events.slug as event_slug, results.channel_id,
              (select count(*)::integer from event_game_player_links links
                where links.channel_id = results.channel_id
                  and left(links.game_player_id, char_length($4)) = $4) as available_slots
         from official_game_results results
         join event_game_score_bindings bindings on bindings.channel_id = results.channel_id
         join events on events.event_id = bindings.event_id
        where results.game_kind = $1 and results.game_instance_id = $2
          and results.result_id = $3 and results.operation = 'record'
          and results.status = 'processed'
        order by results.revision desc limit 1
        for update of results`,
      [input.gameKind, input.gameInstanceId, input.resultId, input.gamePlayerPrefix],
    );
    const official = result.rows[0];
    if (!official)
      return {
        ok: false as const,
        status: 409,
        error: "The confirmed result is still being recorded. Try again in a moment.",
      };
    const maximumClaims = Math.min(
      Math.max(1, Math.trunc(input.maximumClaims)),
      official.available_slots,
    );
    if (maximumClaims < 1)
      return { ok: false as const, status: 409, error: "This team has no claimable player slots" };
    await client.query(
      `update game_result_group_claim_sessions
          set status = 'closed', updated_at = now()
        where official_result_id = $1 and status = 'active' and group_key <> $2`,
      [official.id, input.groupKey],
    );
    const sessionId = id("gcs");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    const upserted = await client.query<{ id: string }>(
      `insert into game_result_group_claim_sessions
         (id, official_result_id, event_slug, group_key, group_name, game_player_prefix,
          token_hash, maximum_claims, status, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)
       on conflict (official_result_id, group_key) do update set
         group_name = excluded.group_name,
         game_player_prefix = excluded.game_player_prefix,
         token_hash = excluded.token_hash,
         maximum_claims = excluded.maximum_claims,
         status = 'active',
         expires_at = excluded.expires_at,
         updated_at = now()
       returning id`,
      [
        sessionId,
        official.id,
        official.event_slug,
        input.groupKey.slice(0, 80),
        input.groupName.slice(0, 80),
        input.gamePlayerPrefix.slice(0, 120),
        hashToken(token),
        maximumClaims,
        expiresAt,
      ],
    );
    const selected = await client.query<GroupClaimSessionRow>(
      `${SESSION_SELECT} where sessions.id = $1`,
      [upserted.rows[0]!.id],
    );
    await client.query(
      `insert into score_audit_events
         (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
       values ($1,'game.group-claim.opened','system','family-feud-controller','group_claim_session',$2,$3::jsonb)`,
      [
        official.event_slug,
        upserted.rows[0]!.id,
        JSON.stringify({
          gameKind: input.gameKind,
          gameInstanceId: input.gameInstanceId,
          resultId: input.resultId,
          groupKey: input.groupKey,
          maximumClaims,
        }),
      ],
    );
    return { ok: true as const, value: { token, session: toSession(selected.rows[0]!) } };
  });
}

export async function readGroupGameClaimSession(input: {
  eventSlug: string;
  token: string;
}): Promise<{ ok: true; value: GroupGameClaimSession } | GroupClaimFailure> {
  if (!input.token || input.token.length > 120)
    return { ok: false, status: 400, error: "This claim link is invalid" };
  const row = await queryOne<GroupClaimSessionRow>(
    `${SESSION_SELECT}
      where sessions.event_slug = $1 and sessions.token_hash = $2`,
    [input.eventSlug, hashToken(input.token)],
  );
  if (!row) return { ok: false, status: 404, error: "This claim link was not found" };
  const session = toSession(row);
  if (session.status === "expired")
    return { ok: false, status: 410, error: "This team claim has expired" };
  if (session.status !== "active")
    return { ok: false, status: 410, error: "This team claim is closed" };
  if (session.claimed >= session.maximumClaims)
    return { ok: false, status: 409, error: "Every player slot for this team has been claimed" };
  return { ok: true, value: session };
}

export async function claimGroupGameResult(input: {
  eventSlug: string;
  token: string;
  targetParticipantId: string;
}): Promise<
  | {
      ok: true;
      value: {
        participantId: string;
        groupName: string;
        pointsAwarded: number;
        previousBalance: number;
        balance: number;
      };
    }
  | GroupClaimFailure
> {
  if (!input.token || input.token.length > 120)
    return { ok: false, status: 400, error: "This claim link is invalid" };
  return transaction(async (client) => {
    const selected = await client.query<GroupClaimSessionRow>(
      `${SESSION_SELECT}
        where sessions.event_slug = $1 and sessions.token_hash = $2
        for update of sessions`,
      [input.eventSlug, hashToken(input.token)],
    );
    const row = selected.rows[0];
    if (!row) return { ok: false as const, status: 404, error: "This claim link was not found" };
    const session = toSession(row);
    const existing = await client.query<{
      session_id: string;
      points_awarded: number;
      balance: number;
    }>(
      `select claims.session_id, claims.points_awarded,
              coalesce(projections.balance, 0)::integer as balance
         from game_result_group_claims claims
         left join score_projections projections
           on projections.participant_id = claims.target_participant_id
        where claims.official_result_id = $1 and claims.target_participant_id = $2
          and claims.state = 'accepted'`,
      [row.official_result_id, input.targetParticipantId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].session_id !== session.id)
        return {
          ok: false as const,
          status: 409,
          error: "You already claimed a team in this match",
        };
      const pointsAwarded = Number(existing.rows[0].points_awarded);
      const balance = Number(existing.rows[0].balance);
      return {
        ok: true as const,
        value: {
          participantId: input.targetParticipantId,
          groupName: session.groupName,
          pointsAwarded,
          previousBalance: balance - pointsAwarded,
          balance,
        },
      };
    }
    if (session.status !== "active" || session.expiresAt <= Date.now())
      return { ok: false as const, status: 410, error: "This team claim is closed or expired" };
    if (session.claimed >= session.maximumClaims)
      return { ok: false as const, status: 409, error: "Every player slot has been claimed" };
    const target = await client.query<{ id: string; balance: number }>(
      `select participants.id, coalesce(projections.balance, 0)::integer as balance
         from event_participants participants
         left join score_projections projections on projections.participant_id = participants.id
        where participants.id = $1 and participants.event_slug = $2
          and participants.status = 'active' and participants.ticket_id is not null
          and participants.checked_in_at is not null
        for update of participants`,
      [input.targetParticipantId, input.eventSlug],
    );
    if (!target.rows[0])
      return { ok: false as const, status: 403, error: "Check in with your event ticket first" };
    const source = await client.query<{ participant_id: string; points: number }>(
      `select links.participant_id,
              coalesce((
                select sum(postings.points)
                  from score_postings postings
                  join score_transactions transactions on transactions.id = postings.transaction_id
                 where postings.participant_id = participants.id
                   and transactions.status = 'accepted'
              ), 0)::integer as points
         from game_result_group_claim_sessions sessions
         join official_game_results results on results.id = sessions.official_result_id
         join event_game_player_links links on links.channel_id = results.channel_id
         join event_participants participants on participants.id = links.participant_id
        where sessions.id = $1
          and left(links.game_player_id, char_length(sessions.game_player_prefix)) = sessions.game_player_prefix
          and participants.status = 'active'
          and participants.ticket_id is null and participants.person_id is null
          and not exists (
            select 1 from game_result_group_claims claims
             where claims.official_result_id = sessions.official_result_id
               and claims.source_participant_id = participants.id
          )
        order by links.game_player_id
        limit 1
        for update of participants`,
      [session.id],
    );
    if (!source.rows[0])
      return { ok: false as const, status: 409, error: "Every player slot has been claimed" };
    const claimId = id("gcc");
    await client.query(
      `insert into game_result_group_claims
         (id, session_id, official_result_id, source_participant_id, target_participant_id, state)
       values ($1,$2,$3,$4,$5,'pending')`,
      [
        claimId,
        session.id,
        row.official_result_id,
        source.rows[0].participant_id,
        input.targetParticipantId,
      ],
    );
    const merged = await mergeParticipantsInTransaction(client, {
      eventSlug: input.eventSlug,
      sourceParticipantId: source.rows[0].participant_id,
      targetParticipantId: input.targetParticipantId,
      actorId: `attendee:${input.targetParticipantId}`,
      reason: "The attendee claimed a team slot from an official game result",
      evidence: [`group-game-claim:${session.id}`],
    });
    if (!merged.ok) {
      await client.query("delete from game_result_group_claims where id = $1", [claimId]);
      return { ok: false as const, status: merged.status, error: merged.error };
    }
    const updated = await client.query<{ balance: number }>(
      `select coalesce(balance, 0)::integer as balance from score_projections
        where participant_id = $1`,
      [input.targetParticipantId],
    );
    const previousBalance = Number(target.rows[0].balance);
    const balance = Number(updated.rows[0]?.balance ?? previousBalance + source.rows[0].points);
    const pointsAwarded = balance - previousBalance;
    await client.query(
      `update game_result_group_claims
          set state = 'accepted', points_awarded = $2, accepted_at = now()
        where id = $1`,
      [claimId, pointsAwarded],
    );
    await client.query(
      `insert into score_audit_events
         (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
       values ($1,'game.group-claim.accepted','attendee',$2,'group_claim',$3,$4::jsonb)`,
      [
        input.eventSlug,
        input.targetParticipantId,
        claimId,
        JSON.stringify({
          sessionId: session.id,
          officialResultId: row.official_result_id,
          sourceParticipantId: source.rows[0].participant_id,
          pointsAwarded,
        }),
      ],
    );
    return {
      ok: true as const,
      value: {
        participantId: input.targetParticipantId,
        groupName: session.groupName,
        pointsAwarded,
        previousBalance,
        balance,
      },
    };
  });
}

export async function closeGroupGameClaimSession(input: {
  sessionId: string;
  gameInstanceId: string;
}) {
  const row = await queryOne<{ id: string }>(
    `update game_result_group_claim_sessions sessions
        set status = 'closed', updated_at = now()
       from official_game_results results
      where sessions.id = $1 and results.id = sessions.official_result_id
        and results.game_instance_id = $2
      returning sessions.id`,
    [input.sessionId, input.gameInstanceId],
  );
  return row
    ? { ok: true as const }
    : { ok: false as const, status: 404, error: "Claim not found" };
}
