import { randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getEvent } from "@/features/events/store.server";
import {
  activityCanAccept,
  canAcceptScore,
  convertRulePoints,
  hasUnresolvedTie,
  rankScores,
  type ActivityStatus,
  type ActivityTemplate,
  type LeaderboardVisibility,
  type RankedScore,
  type ScoreActivity,
  type ScoreParticipant,
  type ScorePosting,
  type ScoreProjection,
  type ScoreRule,
  type ScoreTransaction,
  type ScoringSettings,
  type ScoringState,
} from "./types";
import {
  createActivity,
  getActivity,
  getOrCreateSettings,
  getParticipant,
  listActivities,
  listLeaderboardParticipants,
  listTransactionsForParticipant,
  markParticipantCheckedIn,
  participantForTicket,
  recordScore,
  reverseScore,
  updateActivity,
  updateSettings,
  type RecordScoreInput,
} from "./store.server";

export type ScoringOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function isValidTransition(from: ScoringState, to: ScoringState): boolean {
  if (from === to) return true;
  if (from === "off") return to === "ready";
  if (from === "ready") return to === "live" || to === "off";
  if (from === "live") return to === "frozen" || to === "closed";
  if (from === "frozen") return to === "live" || to === "closed";
  return to === "ready";
}

export async function getScoring(eventSlug: string): Promise<ScoringSettings> {
  return getOrCreateSettings(eventSlug);
}

export async function changeScoringState(input: {
  eventSlug: string;
  state: ScoringState;
  actorId: string;
  reason?: string;
  force?: boolean;
}): Promise<ScoringOperationResult<ScoringSettings>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  const current = await getOrCreateSettings(input.eventSlug);
  if (!input.force && !isValidTransition(current.state, input.state)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot move scoring from ${current.state} to ${input.state}`,
    };
  }
  const next = await updateSettings(input.eventSlug, { state: input.state });
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'scoring.state.changed','admin',$2,'scoring_settings',$1,$3::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      JSON.stringify({ from: current.state, to: input.state, reason: input.reason ?? null }),
    ],
  );
  return { ok: true, value: next };
}

export async function configureScoring(input: {
  eventSlug: string;
  leaderboardVisibility?: LeaderboardVisibility;
  scheduledStart?: string;
  scheduledEnd?: string;
  allowPreCheckinOnlinePoints?: boolean;
  publicNames?: ScoringSettings["publicNames"];
  publicRankingPolicy?: ScoringSettings["publicRankingPolicy"];
  photoConsentPolicy?: ScoringSettings["photoConsentPolicy"];
  actorId: string;
}): Promise<ScoringOperationResult<ScoringSettings>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (input.scheduledStart && Number.isNaN(Date.parse(input.scheduledStart))) {
    return { ok: false, status: 400, error: "The scoring start is not a valid date" };
  }
  if (input.scheduledEnd && Number.isNaN(Date.parse(input.scheduledEnd))) {
    return { ok: false, status: 400, error: "The scoring end is not a valid date" };
  }
  await getOrCreateSettings(input.eventSlug);
  const settings = await updateSettings(input.eventSlug, input);
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'scoring.settings.updated','admin',$2,'scoring_settings',$1,$3::jsonb)`,
    [input.eventSlug, input.actorId, JSON.stringify({ revision: settings.revision })],
  );
  return { ok: true, value: settings };
}

export async function createScoringActivity(input: {
  eventSlug: string;
  name: string;
  template: ActivityTemplate;
  rule: ScoreRule;
  status?: ActivityStatus;
  startsAt?: string;
  endsAt?: string;
  actorId: string;
}): Promise<ScoringOperationResult<ScoreActivity>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (!input.name.trim()) return { ok: false, status: 400, error: "Name the activity" };
  if (input.rule.mode === "fixed" && (input.rule.fixedPoints ?? 0) <= 0) {
    return { ok: false, status: 400, error: "A fixed activity needs positive points" };
  }
  const activity = await createActivity(input);
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id)
     values ($1,'activity.created','admin',$2,'activity',$3)`,
    [input.eventSlug, input.actorId, activity.id],
  );
  return { ok: true, value: activity };
}

export async function updateScoringActivity(input: {
  activityId: string;
  actorId: string;
  name?: string;
  status?: ActivityStatus;
  startsAt?: string;
  endsAt?: string;
  rule?: ScoreRule;
}): Promise<ScoringOperationResult<ScoreActivity>> {
  const activity = await getActivity(input.activityId);
  if (!activity) return { ok: false, status: 404, error: "Activity not found" };
  if (activity.status === "ended" && input.rule) {
    return { ok: false, status: 409, error: "Ended activity rules cannot be changed" };
  }
  const updated = await updateActivity(input.activityId, input);
  if (!updated) return { ok: false, status: 404, error: "Activity not found" };
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'activity.updated','admin',$2,'activity',$3,$4::jsonb)`,
    [
      updated.eventSlug,
      input.actorId,
      updated.id,
      JSON.stringify({ ruleRevision: updated.ruleRevision }),
    ],
  );
  return { ok: true, value: updated };
}

export async function listScoringActivities(eventSlug: string): Promise<ScoreActivity[]> {
  return listActivities(eventSlug);
}

export type AwardPointsInput = {
  eventSlug: string;
  activityId: string;
  participantIds: string[];
  rawScore?: number;
  placement?: number;
  points?: number;
  sourceId?: string;
  idempotencyKey: string;
  actorType: "admin" | "staff" | "system" | "attendee";
  actorId?: string;
  assignmentId?: string;
  stationId?: string;
  deviceId?: string;
  note?: string;
  reasonCode?: RecordScoreInput["reasonCode"];
  poolId?: string;
  allowOverride?: boolean;
};

export async function awardPoints(
  input: AwardPointsInput,
): Promise<ScoringOperationResult<ScoreTransaction>> {
  const activity = await getActivity(input.activityId);
  if (!activity || activity.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Activity not found" };
  }
  const settings = await getOrCreateSettings(input.eventSlug);
  const sourceId = input.sourceId ?? id("award");
  if (settings.state !== "live" && settings.state !== "frozen") {
    return {
      ok: false,
      status: 409,
      error: "Scoring is not live or is closed",
    };
  }
  if (!activityCanAccept(activity)) {
    return { ok: false, status: 409, error: "This activity is not accepting results" };
  }
  if (input.participantIds.length === 0)
    return { ok: false, status: 400, error: "Choose at least one participant" };
  const points = input.points ?? convertRulePoints(activity.rule, input);
  if (!Number.isInteger(points) || points <= 0) {
    return { ok: false, status: 400, error: "This result does not award points" };
  }
  if (input.allowOverride && !input.note?.trim()) {
    return { ok: false, status: 400, error: "An override needs a note" };
  }
  const postings: ScorePosting[] = input.participantIds.map((participantId) => ({
    participantId,
    points,
  }));
  const result = await recordScore({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    sourceType: activity.template === "discovery" ? "discovery" : "manual",
    sourceId,
    idempotencyKey: input.idempotencyKey,
    reasonCode: input.reasonCode ?? (activity.template as RecordScoreInput["reasonCode"]),
    note: input.note,
    ruleRevision: activity.ruleRevision,
    actorType: input.actorType,
    actorId: input.actorId,
    assignmentId: input.assignmentId,
    stationId: input.stationId,
    deviceId: input.deviceId,
    postings,
    poolId: input.poolId,
  });
  return result;
}

export async function transferPoints(input: {
  eventSlug: string;
  fromParticipantId: string;
  toParticipantId: string;
  points: number;
  idempotencyKey: string;
  actorType: "admin" | "staff" | "attendee";
  actorId?: string;
  note: string;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  if (!Number.isInteger(input.points) || input.points <= 0)
    return { ok: false, status: 400, error: "Choose positive whole points" };
  if (!input.note.trim()) return { ok: false, status: 400, error: "A transfer needs a note" };
  const from = await getParticipant(input.fromParticipantId);
  const to = await getParticipant(input.toParticipantId);
  if (!from || !to || from.eventSlug !== input.eventSlug || to.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Participant not found" };
  }
  return recordScore({
    eventSlug: input.eventSlug,
    sourceType: "transfer",
    sourceId: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    reasonCode: "transfer",
    note: input.note,
    actorType: input.actorType,
    actorId: input.actorId,
    postings: [
      { participantId: from.id, points: -input.points },
      { participantId: to.id, points: input.points },
    ],
  });
}

export async function reversePoints(input: {
  eventSlug: string;
  transactionId: string;
  idempotencyKey: string;
  actorType: "admin" | "staff";
  actorId?: string;
  note: string;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  if (!input.note.trim()) return { ok: false, status: 400, error: "A reversal needs a note" };
  return reverseScore(input.eventSlug, input.transactionId, {
    idempotencyKey: input.idempotencyKey,
    reasonCode: "reversal",
    note: input.note,
    actorType: input.actorType,
    actorId: input.actorId,
  });
}

export type PublicLeaderboardRow = {
  rank: number;
  publicAlias: string;
  points: number;
  team?: string;
  isCurrentAttendee?: boolean;
};

export async function publicLeaderboard(input: {
  eventSlug: string;
  currentParticipantId?: string;
  includePreview?: boolean;
}): Promise<
  ScoringOperationResult<{
    state: ScoringState;
    visibility: LeaderboardVisibility;
    rows: PublicLeaderboardRow[];
  }>
> {
  if (!(await getEvent(input.eventSlug)))
    return { ok: false, status: 404, error: "Event not found" };
  const settings = await getOrCreateSettings(input.eventSlug);
  const isVisible =
    settings.leaderboardVisibility === "public-live" ||
    settings.leaderboardVisibility === "public-final";
  if (!isVisible && !(input.includePreview && settings.leaderboardVisibility === "preview")) {
    return {
      ok: true,
      value: { state: settings.state, visibility: settings.leaderboardVisibility, rows: [] },
    };
  }
  const participants = (await listLeaderboardParticipants(input.eventSlug)).filter((participant) =>
    settings.publicRankingPolicy === "include"
      ? true
      : settings.publicRankingPolicy === "exclude-refunded"
        ? participant.status !== "refunded"
        : participant.status !== "disqualified",
  );
  const ranked = rankScores(participants);
  return {
    ok: true,
    value: {
      state: settings.state,
      visibility: settings.leaderboardVisibility,
      rows: ranked.map((score) => ({
        rank: score.rank,
        publicAlias: score.publicAlias,
        points: score.balance,
        team: score.teamName,
        isCurrentAttendee: score.participantId === input.currentParticipantId,
      })),
    },
  };
}

export async function personalScore(input: {
  eventSlug: string;
  ticketId: string;
  includeHistory?: boolean;
}): Promise<
  ScoringOperationResult<{
    participant: Pick<
      ScoreParticipant,
      "id" | "publicAlias" | "teamName" | "status" | "checkedInAt"
    > &
      Pick<ScoreProjection, "balance" | "revision" | "lastTransactionAt">;
    rank: number;
    teamRank?: number;
    transactions: Array<{
      status: ScoreTransaction["status"];
      reasonCode: ScoreTransaction["reasonCode"];
      points: number;
      createdAt: string;
    }>;
  }>
> {
  const participant = await participantForTicket(input.ticketId);
  if (!participant || participant.eventSlug !== input.eventSlug)
    return { ok: false, status: 404, error: "Ticket participant not found" };
  const ranked = rankScores(await listLeaderboardParticipants(input.eventSlug));
  const current = ranked.find((score) => score.participantId === participant.id);
  const teamRank =
    participant.teamId && current
      ? rankScores(ranked.filter((score) => score.teamId === participant.teamId)).find(
          (score) => score.participantId === participant.id,
        )?.rank
      : undefined;
  const transactions =
    input.includeHistory === false
      ? []
      : (await listTransactionsForParticipant(participant.id)).map((transaction) => ({
          status: transaction.status,
          reasonCode: transaction.reasonCode,
          points: transaction.postings
            .filter((posting) => posting.participantId === participant.id)
            .reduce((sum, posting) => sum + posting.points, 0),
          createdAt: transaction.createdAt,
        }));
  return {
    ok: true,
    value: {
      participant: {
        id: participant.id,
        publicAlias: participant.publicAlias,
        teamName: participant.teamName,
        status: participant.status,
        checkedInAt: participant.checkedInAt,
        balance: participant.balance,
        revision: participant.revision,
        lastTransactionAt: participant.lastTransactionAt,
      },
      rank: current?.rank ?? ranked.length + 1,
      teamRank,
      transactions,
    },
  };
}

export async function checkInForScoring(input: {
  eventSlug: string;
  ticketId: string;
  idempotencyKey: string;
  actorId: string;
  checkInPoints?: number;
}): Promise<ScoringOperationResult<ScoreTransaction | null>> {
  const participant = await participantForTicket(input.ticketId);
  if (!participant || participant.eventSlug !== input.eventSlug)
    return { ok: false, status: 404, error: "Ticket participant not found" };
  await markParticipantCheckedIn(participant.id);
  if (!input.checkInPoints) return { ok: true, value: null };
  const settings = await getOrCreateSettings(input.eventSlug);
  if (!canAcceptScore(settings, "normal"))
    return { ok: false, status: 409, error: "Scoring is not live" };
  return recordScore({
    eventSlug: input.eventSlug,
    sourceType: "check-in",
    sourceId: input.ticketId,
    idempotencyKey: input.idempotencyKey,
    reasonCode: "check-in",
    actorType: "system",
    actorId: input.actorId,
    postings: [{ participantId: participant.id, points: input.checkInPoints }],
  });
}

export async function mergeParticipants(input: {
  eventSlug: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  actorId: string;
  reason: string;
  evidence: string[];
}): Promise<ScoringOperationResult<void>> {
  if (!input.reason.trim() || input.evidence.length === 0)
    return { ok: false, status: 400, error: "A merge needs evidence and a reason" };
  if (input.sourceParticipantId === input.targetParticipantId)
    return { ok: false, status: 400, error: "Choose two different participants" };
  try {
    await transaction(async (client) => {
      const rows = await client.query<{ id: string; event_slug: string; person_id: string | null }>(
        `select id, event_slug, person_id from event_participants
          where id = any($1::text[]) for update`,
        [[input.sourceParticipantId, input.targetParticipantId]],
      );
      if (rows.rows.length !== 2 || rows.rows.some((row) => row.event_slug !== input.eventSlug))
        throw new Error("Participants not found");
      await client.query(
        `insert into event_participant_merges
          (id, event_slug, source_participant_id, target_participant_id, actor_id, evidence, reason)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [
          id("merge"),
          input.eventSlug,
          input.sourceParticipantId,
          input.targetParticipantId,
          input.actorId,
          JSON.stringify(input.evidence),
          input.reason,
        ],
      );
      await client.query(
        `update event_participants set status = 'merged', updated_at = now() where id = $1`,
        [input.sourceParticipantId],
      );
      await client.query(
        `insert into score_audit_events
          (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
         values ($1,'identity.participants.merged','admin',$2,'participant',$3,$4::jsonb)`,
        [
          input.eventSlug,
          input.actorId,
          input.sourceParticipantId,
          JSON.stringify({
            target: input.targetParticipantId,
            evidence: input.evidence,
            reason: input.reason,
          }),
        ],
      );
    });
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, status: 404, error: "Participants not found" };
  }
}

export async function reverseParticipantMerge(input: {
  mergeId: string;
  actorId: string;
  reason: string;
}): Promise<ScoringOperationResult<void>> {
  if (!input.reason.trim()) return { ok: false, status: 400, error: "A split needs a reason" };
  const row = await queryOne<{ event_slug: string; source_participant_id: string }>(
    `update event_participant_merges
        set reversed_at = now(), reversed_by = $2, reversal_reason = $3
      where id = $1 and reversed_at is null
      returning event_slug, source_participant_id`,
    [input.mergeId, input.actorId, input.reason],
  );
  if (!row) return { ok: false, status: 404, error: "Merge not found or already reversed" };
  await query(`update event_participants set status = 'active', updated_at = now() where id = $1`, [
    row.source_participant_id,
  ]);
  await query(
    `insert into score_audit_events
      (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'identity.participants.split','admin',$2,'participant',$3,$4::jsonb)`,
    [
      row.event_slug,
      input.actorId,
      row.source_participant_id,
      JSON.stringify({ mergeId: input.mergeId, reason: input.reason }),
    ],
  );
  return { ok: true, value: undefined };
}

export function canFinalizeLeaderboard(
  rows: readonly RankedScore[],
  prizeSlots: number,
): ScoringOperationResult<{ ties: boolean }> {
  const ties = hasUnresolvedTie(rows, prizeSlots);
  return ties
    ? { ok: false, status: 409, error: "Resolve the tied prize places before finalizing" }
    : { ok: true, value: { ties: false } };
}

export async function finalizeLeaderboard(input: {
  eventSlug: string;
  actorId: string;
  prizeSlots: number;
  resolvedTies?: boolean;
  reason?: string;
}): Promise<ScoringOperationResult<{ status: "final"; resolvedTies: boolean }>> {
  const settings = await getOrCreateSettings(input.eventSlug);
  if (settings.state !== "frozen" && settings.state !== "closed") {
    return { ok: false, status: 409, error: "Freeze or close scoring before finalizing the board" };
  }
  const ranked = rankScores(await listLeaderboardParticipants(input.eventSlug));
  const check = canFinalizeLeaderboard(ranked, Math.max(1, Math.trunc(input.prizeSlots)));
  if (!check.ok && !input.resolvedTies) return check;
  await query(
    `insert into score_prize_finalizations
       (event_slug, status, finalized_by, reason, resolved_ties)
     values ($1,'final',$2,$3,$4)
     on conflict (event_slug) do update set
       status = 'final', finalized_by = excluded.finalized_by,
       reason = excluded.reason, resolved_ties = excluded.resolved_ties,
       updated_at = now()`,
    [input.eventSlug, input.actorId, input.reason ?? null, input.resolvedTies === true],
  );
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'leaderboard.finalized','admin',$2,'leaderboard',$1,$3::jsonb)`,
    [
      input.eventSlug,
      input.actorId,
      JSON.stringify({ prizeSlots: input.prizeSlots, resolvedTies: input.resolvedTies === true }),
    ],
  );
  return { ok: true, value: { status: "final", resolvedTies: input.resolvedTies === true } };
}
