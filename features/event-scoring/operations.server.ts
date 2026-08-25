import { queryOne } from "@/lib/platform/postgres.server";

export type ScoringOperationsSnapshot = {
  windowMinutes: number;
  scoreWrites: number;
  rejectedCommands: number;
  heldActions: number;
  projectionDrift: number;
  exhaustedPools: number;
  discoveryClaims: number;
  discoveryRejected: number;
  mediaLinks: number;
  mediaFailures: number;
  writeFailures: number;
  sessionFailures: number;
  alerts: Array<{
    code: "repeated-write-failure" | "projection-drift" | "abnormal-rejection-rate" | "held-work";
    severity: "warning" | "critical";
    message: string;
  }>;
};

/** An admin-only bounded aggregate. It never runs on attendee, public, or game requests. */
export async function getScoringOperationsSnapshot(
  eventSlug: string,
  windowMinutes = 15,
): Promise<ScoringOperationsSnapshot> {
  const minutes = Math.min(24 * 60, Math.max(1, Math.trunc(windowMinutes)));
  const row = await queryOne<{
    score_writes: number;
    rejected_commands: number;
    held_actions: number;
    projection_drift: number;
    exhausted_pools: number;
    discovery_claims: number;
    discovery_rejected: number;
    media_links: number;
    media_failures: number;
    write_failures: number;
    session_failures: number;
  }>(
    `with ledger as (
       select postings.participant_id, coalesce(sum(postings.points), 0)::integer as balance
         from score_postings postings
         join score_transactions transactions on transactions.id = postings.transaction_id
        where postings.event_slug = $1 and transactions.status in ('accepted', 'reversed')
        group by postings.participant_id
     )
     select
       (select count(*)::integer from score_transactions
         where event_slug = $1 and status = 'accepted'
           and created_at >= now() - make_interval(mins => $2)) as score_writes,
       (select count(*)::integer from score_transactions
         where event_slug = $1 and status = 'rejected'
           and created_at >= now() - make_interval(mins => $2)) as rejected_commands,
       (select count(*)::integer from score_transactions
         where event_slug = $1 and status = 'held') as held_actions,
       (select count(*)::integer
          from event_participants participants
          left join ledger on ledger.participant_id = participants.id
          left join score_projections projections on projections.participant_id = participants.id
         where participants.event_slug = $1
           and coalesce(ledger.balance, 0) <> coalesce(projections.balance, 0)) as projection_drift,
       (select count(*)::integer from score_pools
         where event_slug = $1 and issued_points - reserved_points - spent_points - held_points = 0)
         as exhausted_pools,
       (select count(*)::integer from score_discovery_claims
         where event_slug = $1 and state = 'accepted'
           and created_at >= now() - make_interval(mins => $2)) as discovery_claims,
       (select count(*)::integer from score_discovery_claims
         where event_slug = $1 and state = 'rejected'
           and created_at >= now() - make_interval(mins => $2)) as discovery_rejected,
       (select count(*)::integer from score_media_links
         where event_slug = $1 and deleted_at is null) as media_links,
       (select count(*)::integer from score_media_links
         where event_slug = $1 and visibility = 'discard') +
       (select count(*)::integer from score_operational_events
         where event_slug = $1 and kind = 'media-failure'
           and created_at >= now() - make_interval(mins => $2)) as media_failures,
       (select count(*)::integer from score_operational_events
         where event_slug = $1 and kind = 'write-failure'
           and created_at >= now() - make_interval(mins => $2)) as write_failures,
       (select count(*)::integer from score_operational_events
         where event_slug = $1 and kind = 'session-failure'
           and created_at >= now() - make_interval(mins => $2)) as session_failures`,
    [eventSlug, minutes],
  );
  const counts = row ?? {
    score_writes: 0,
    rejected_commands: 0,
    held_actions: 0,
    projection_drift: 0,
    exhausted_pools: 0,
    discovery_claims: 0,
    discovery_rejected: 0,
    media_links: 0,
    media_failures: 0,
    write_failures: 0,
    session_failures: 0,
  };
  const alerts: ScoringOperationsSnapshot["alerts"] = [];
  if (counts.write_failures >= 3)
    alerts.push({
      code: "repeated-write-failure",
      severity: "critical",
      message: `${counts.write_failures} score writes failed in ${minutes} minutes.`,
    });
  if (counts.projection_drift > 0)
    alerts.push({
      code: "projection-drift",
      severity: "critical",
      message: `${counts.projection_drift} score projections differ from the immutable ledger.`,
    });
  const decided = counts.score_writes + counts.rejected_commands;
  if (counts.rejected_commands >= 10 && counts.rejected_commands / Math.max(1, decided) >= 0.3)
    alerts.push({
      code: "abnormal-rejection-rate",
      severity: "warning",
      message: `${counts.rejected_commands} commands were rejected in ${minutes} minutes.`,
    });
  if (counts.held_actions >= 10)
    alerts.push({
      code: "held-work",
      severity: "warning",
      message: `${counts.held_actions} score actions need human review.`,
    });
  return {
    windowMinutes: minutes,
    scoreWrites: counts.score_writes,
    rejectedCommands: counts.rejected_commands,
    heldActions: counts.held_actions,
    projectionDrift: counts.projection_drift,
    exhaustedPools: counts.exhausted_pools,
    discoveryClaims: counts.discovery_claims,
    discoveryRejected: counts.discovery_rejected,
    mediaLinks: counts.media_links,
    mediaFailures: counts.media_failures,
    writeFailures: counts.write_failures,
    sessionFailures: counts.session_failures,
    alerts,
  };
}

export async function recordScoringOperationalEvent(input: {
  eventSlug: string;
  kind: "write-failure" | "session-failure" | "media-failure";
  operation: string;
}): Promise<void> {
  await queryOne(
    `insert into score_operational_events (event_slug, kind, detail)
     values ($1,$2,$3::jsonb) returning id`,
    [input.eventSlug, input.kind, JSON.stringify({ operation: input.operation })],
  );
}
