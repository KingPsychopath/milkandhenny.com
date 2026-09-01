import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getEvent } from "@/features/events/store.server";
import { isCapabilityEffective } from "@/features/attendee-operations/capabilities.server";
import {
  activityCanAccept,
  canAcceptScore,
  convertRulePoints,
  hasUnresolvedTie,
  rankScores,
  leaderboardNameFor,
  type ActivityStatus,
  type ActivityTemplate,
  type LeaderboardVisibility,
  type PublicLeaderboardRow,
  type RankedScore,
  type ScoreActivity,
  type ScoreParticipant,
  type ScorePosting,
  type ScoreProjection,
  type ScoreRule,
  SCORE_ECONOMY,
  scoreRuleBalanceError,
  type ScoreTransaction,
  type ScoringSettings,
  type ScoringState,
} from "./types";
import {
  createActivity,
  findSettings,
  getActivity,
  getOrCreateSettings,
  getParticipant,
  listActivities,
  listLeaderboardParticipants,
  listParticipantScoreEntries,
  listPublicScoreBreakdowns,
  listTeamLeaderboardTotals,
  markParticipantCheckedIn,
  participantForTicket,
  recordScore,
  releaseActivityReservations,
  reverseScore,
  ticketOrderSummaryForParticipant,
  updateActivity,
  updateSettings,
  type RecordScoreInput,
} from "./store.server";
import { retryHeldOfficialGameResultsForEvent } from "./games.server";

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

export async function processScheduledScoringTransitions(now = new Date()): Promise<number> {
  const transitions = await transaction(async (client) => {
    const changed = await client.query<{
      event_slug: string;
      from_state: ScoringState;
      to_state: ScoringState;
      from_leaderboard_visibility: LeaderboardVisibility;
      leaderboard_visibility: LeaderboardVisibility;
    }>(
      `with due as (
         select event_slug, state as from_state,
                leaderboard_visibility as from_leaderboard_visibility,
                case
                  when scheduled_end is not null and scheduled_end <= $1
                    and state in ('ready', 'live', 'frozen') then 'closed'
                  when scheduled_freeze is not null and scheduled_freeze <= $1
                    and state = 'live' then 'frozen'
                  when scheduled_start is not null and scheduled_start <= $1
                    and state = 'ready' then 'live'
                  else state
                end as to_state
           from event_scoring_settings
          where (scheduled_start is not null and scheduled_start <= $1 and state = 'ready')
             or (scheduled_freeze is not null and scheduled_freeze <= $1 and state = 'live')
             or (scheduled_end is not null and scheduled_end <= $1
                 and state in ('ready', 'live', 'frozen'))
          for update
       )
       update event_scoring_settings settings
          set state = due.to_state,
              leaderboard_visibility = case
                when due.to_state = 'closed' then 'public-final'
                when due.to_state = 'live' and settings.leaderboard_visibility = 'preview'
                  then 'public-live'
                else settings.leaderboard_visibility
              end,
              revision = settings.revision + 1,
              updated_at = now()
         from due
        where settings.event_slug = due.event_slug and due.from_state <> due.to_state
       returning settings.event_slug, due.from_state, due.to_state,
                 due.from_leaderboard_visibility, settings.leaderboard_visibility`,
      [now],
    );
    for (const row of changed.rows) {
      await client.query(
        `insert into score_audit_events
           (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
         values ($1,'scoring.state.scheduled','system','scoring-scheduler','scoring_settings',$1,$2::jsonb)`,
        [
          row.event_slug,
          JSON.stringify({
            from: row.from_state,
            to: row.to_state,
            leaderboardVisibility: {
              from: row.from_leaderboard_visibility,
              to: row.leaderboard_visibility,
            },
            evaluatedAt: now.toISOString(),
          }),
        ],
      );
    }
    return changed.rows;
  });
  for (const transition of transitions) {
    if (transition.from_state !== "live" && transition.to_state === "live") {
      await retryHeldOfficialGameResultsForEvent(transition.event_slug);
    }
  }
  return transitions.length;
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
  if (current.state !== "live" && input.state === "live") {
    await retryHeldOfficialGameResultsForEvent(input.eventSlug);
  }
  return { ok: true, value: next };
}

export async function configureScoring(input: {
  eventSlug: string;
  leaderboardVisibility?: LeaderboardVisibility;
  gamesOpenAt?: string | null;
  gamesCloseAt?: string | null;
  scheduledStart?: string | null;
  scheduledFreeze?: string | null;
  scheduledEnd?: string | null;
  allowPreCheckinOnlinePoints?: boolean;
  publicNames?: ScoringSettings["publicNames"];
  publicRankingPolicy?: ScoringSettings["publicRankingPolicy"];
  photoConsentPolicy?: ScoringSettings["photoConsentPolicy"];
  allowStaffSelfAwards?: boolean;
  actorId: string;
}): Promise<ScoringOperationResult<ScoringSettings>> {
  const event = await getEvent(input.eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };
  if (input.gamesOpenAt && Number.isNaN(Date.parse(input.gamesOpenAt))) {
    return { ok: false, status: 400, error: "The games opening is not a valid date" };
  }
  if (input.gamesCloseAt && Number.isNaN(Date.parse(input.gamesCloseAt))) {
    return { ok: false, status: 400, error: "The games closing is not a valid date" };
  }
  if (input.scheduledStart && Number.isNaN(Date.parse(input.scheduledStart))) {
    return { ok: false, status: 400, error: "The scoring start is not a valid date" };
  }
  if (input.scheduledEnd && Number.isNaN(Date.parse(input.scheduledEnd))) {
    return { ok: false, status: 400, error: "The scoring end is not a valid date" };
  }
  if (input.scheduledFreeze && Number.isNaN(Date.parse(input.scheduledFreeze))) {
    return { ok: false, status: 400, error: "The scoring freeze is not a valid date" };
  }
  const start = input.scheduledStart ? Date.parse(input.scheduledStart) : null;
  const freeze = input.scheduledFreeze ? Date.parse(input.scheduledFreeze) : null;
  const end = input.scheduledEnd ? Date.parse(input.scheduledEnd) : null;
  const gamesOpen = input.gamesOpenAt ? Date.parse(input.gamesOpenAt) : null;
  const gamesClose = input.gamesCloseAt ? Date.parse(input.gamesCloseAt) : null;
  if (gamesOpen !== null && gamesClose !== null && gamesClose <= gamesOpen)
    return { ok: false, status: 400, error: "Games must close after they open" };
  if (start !== null && freeze !== null && freeze <= start)
    return { ok: false, status: 400, error: "The scoring freeze must follow the start" };
  if (freeze !== null && end !== null && freeze >= end)
    return { ok: false, status: 400, error: "The scoring freeze must precede the end" };
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
  const balanceError = scoreRuleBalanceError(input.rule);
  if (balanceError) return { ok: false, status: 400, error: balanceError };
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
  if (input.rule) {
    const balanceError = scoreRuleBalanceError(input.rule);
    if (balanceError) return { ok: false, status: 400, error: balanceError };
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
  if (input.status === "ended" || input.status === "cancelled") {
    const releasedPoints = await releaseActivityReservations(updated.eventSlug, updated.id);
    if (releasedPoints > 0) {
      await query(
        `insert into score_audit_events
           (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
         values ($1,'activity.reservations.released','admin',$2,'activity',$3,$4::jsonb)`,
        [updated.eventSlug, input.actorId, updated.id, JSON.stringify({ releasedPoints })],
      );
    }
  }
  return { ok: true, value: updated };
}

export async function listScoringActivities(eventSlug: string): Promise<ScoreActivity[]> {
  return listActivities(eventSlug);
}

export async function copyScoringActivity(input: {
  activityId: string;
  targetEventSlug?: string;
  actorId: string;
}): Promise<ScoringOperationResult<ScoreActivity>> {
  const source = await getActivity(input.activityId);
  if (!source) return { ok: false, status: 404, error: "Activity not found" };
  return createScoringActivity({
    eventSlug: input.targetEventSlug ?? source.eventSlug,
    name: `${source.name} copy`,
    template: source.template,
    rule: structuredClone(source.rule),
    status: "draft",
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    actorId: input.actorId,
  });
}

export type PersonalActivityTemplate = {
  id: string;
  name: string;
  activityTemplate: ActivityTemplate;
  rule: ScoreRule;
  createdAt: string;
  updatedAt: string;
};

export async function listPersonalActivityTemplates(
  actorId: string,
): Promise<PersonalActivityTemplate[]> {
  const rows = await query<{
    id: string;
    name: string;
    activity_template: ActivityTemplate;
    rule: ScoreRule;
    created_at: Date;
    updated_at: Date;
  }>(
    `select id, name, activity_template, rule, created_at, updated_at
       from score_activity_templates
      where created_by = $1
      order by updated_at desc, id`,
    [actorId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    activityTemplate: row.activity_template,
    rule: row.rule,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function savePersonalActivityTemplate(input: {
  activityId: string;
  actorId: string;
  name?: string;
}): Promise<ScoringOperationResult<PersonalActivityTemplate>> {
  const activity = await getActivity(input.activityId);
  if (!activity) return { ok: false, status: 404, error: "Activity not found" };
  const name = input.name?.trim() || activity.name;
  if (!name) return { ok: false, status: 400, error: "Name the template" };
  const row = await queryOne<{
    id: string;
    name: string;
    activity_template: ActivityTemplate;
    rule: ScoreRule;
    created_at: Date;
    updated_at: Date;
  }>(
    `insert into score_activity_templates
       (id, name, activity_template, rule, created_by)
     values ($1,$2,$3,$4::jsonb,$5)
     on conflict (created_by, lower(name)) do update
       set activity_template = excluded.activity_template,
           rule = excluded.rule,
           updated_at = now()
     returning id, name, activity_template, rule, created_at, updated_at`,
    [id("template"), name, activity.template, JSON.stringify(activity.rule), input.actorId],
  );
  if (!row) return { ok: false, status: 500, error: "Could not save the template" };
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'activity.template.saved','admin',$2,'activity_template',$3,$4::jsonb)`,
    [activity.eventSlug, input.actorId, row.id, JSON.stringify({ activityId: activity.id })],
  );
  return {
    ok: true,
    value: {
      id: row.id,
      name: row.name,
      activityTemplate: row.activity_template,
      rule: row.rule,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
  };
}

export async function createActivityFromPersonalTemplate(input: {
  eventSlug: string;
  templateId: string;
  actorId: string;
  name?: string;
}): Promise<ScoringOperationResult<ScoreActivity>> {
  const saved = await queryOne<{
    name: string;
    activity_template: ActivityTemplate;
    rule: ScoreRule;
  }>(
    `select name, activity_template, rule
       from score_activity_templates
      where id = $1 and created_by = $2`,
    [input.templateId, input.actorId],
  );
  if (!saved) return { ok: false, status: 404, error: "Personal template not found" };
  return createScoringActivity({
    eventSlug: input.eventSlug,
    name: input.name?.trim() || saved.name,
    template: saved.activity_template,
    rule: structuredClone(saved.rule),
    status: "draft",
    actorId: input.actorId,
  });
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
  if (!(await isCapabilityEffective(input.eventSlug, "scoring"))) {
    return { ok: false, status: 409, error: "Scoring is paused for this event" };
  }
  if (
    (input.actorType === "admin" || input.actorType === "staff") &&
    !(await isCapabilityEffective(input.eventSlug, "manualStaffAwards"))
  ) {
    return { ok: false, status: 409, error: "Manual awards are paused for this event" };
  }
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
  if (points > SCORE_ECONOMY.maximumSingleAward) {
    return {
      ok: false,
      status: 400,
      error: `One result cannot award more than ${SCORE_ECONOMY.maximumSingleAward} points per person`,
    };
  }
  if (input.allowOverride && !input.note?.trim()) {
    return { ok: false, status: 400, error: "An override needs a note" };
  }
  if (activity.template === "free-form" && !input.note?.trim()) {
    return { ok: false, status: 400, error: "A free-form award needs a note" };
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

export async function applyPenalty(input: {
  eventSlug: string;
  activityId: string;
  participantId: string;
  points: number;
  idempotencyKey: string;
  actorType: "admin" | "staff";
  actorId?: string;
  assignmentId?: string;
  stationId?: string;
  deviceId?: string;
  note: string;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  if (!Number.isInteger(input.points) || input.points <= 0) {
    return { ok: false, status: 400, error: "Choose positive whole penalty points" };
  }
  if (!input.note.trim()) return { ok: false, status: 400, error: "A penalty needs a note" };
  const activity = await getActivity(input.activityId);
  if (!activity || activity.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Activity not found" };
  }
  return recordScore({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    sourceType: "correction",
    sourceId: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    reasonCode: "penalty",
    note: input.note,
    ruleRevision: activity.ruleRevision,
    actorType: input.actorType,
    actorId: input.actorId,
    assignmentId: input.assignmentId,
    stationId: input.stationId,
    deviceId: input.deviceId,
    postings: [{ participantId: input.participantId, points: -input.points }],
  });
}

export async function correctPointsAfterClose(input: {
  eventSlug: string;
  activityId: string;
  participantId: string;
  delta: number;
  idempotencyKey: string;
  actorId: string;
  note: string;
  confirmed: boolean;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    return { ok: false, status: 400, error: "Choose a non-zero whole-point correction" };
  }
  if (!input.note.trim()) return { ok: false, status: 400, error: "A correction needs a reason" };
  if (!input.confirmed) {
    return { ok: false, status: 409, error: "Confirm the closed-event correction" };
  }
  const settings = await getOrCreateSettings(input.eventSlug);
  if (settings.state !== "closed") {
    return { ok: false, status: 409, error: "This workflow is only for closed scoring" };
  }
  const activity = await getActivity(input.activityId);
  if (!activity || activity.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Activity not found" };
  }
  return recordScore({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    sourceType: "correction",
    sourceId: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    reasonCode: "correction",
    note: input.note,
    ruleRevision: activity.ruleRevision,
    actorType: "admin",
    actorId: input.actorId,
    metadata: { closedCorrectionConfirmed: true, requiresRefinalization: true },
    postings: [{ participantId: input.participantId, points: input.delta }],
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

export async function publicLeaderboard(input: {
  eventSlug: string;
  currentParticipantId?: string;
  includePreview?: boolean;
}): Promise<
  ScoringOperationResult<{
    state: ScoringState;
    visibility: LeaderboardVisibility;
    boardStatus: "live" | "frozen" | "closed" | "corrected-provisional" | "final";
    rows: PublicLeaderboardRow[];
    teams: Array<{
      id: string;
      name: string;
      colourKey?: import("./team-palette").TeamColourKey;
      points: number;
      rank: number;
    }>;
  }>
> {
  if (!(await getEvent(input.eventSlug)))
    return { ok: false, status: 404, error: "Event not found" };
  const settings = await getOrCreateSettings(input.eventSlug);
  const finalization = await queryOne<{ status: "provisional" | "final" }>(
    `select status from score_prize_finalizations where event_slug = $1`,
    [input.eventSlug],
  );
  const boardStatus =
    finalization?.status === "final"
      ? "final"
      : finalization?.status === "provisional"
        ? "corrected-provisional"
        : settings.state === "frozen"
          ? "frozen"
          : settings.state === "closed"
            ? "closed"
            : "live";
  if (!(await isCapabilityEffective(input.eventSlug, "publicLeaderboard"))) {
    return {
      ok: true,
      value: {
        state: settings.state,
        visibility: settings.leaderboardVisibility,
        boardStatus,
        rows: [],
        teams: [],
      },
    };
  }
  const isVisible =
    settings.leaderboardVisibility === "public-live" ||
    settings.leaderboardVisibility === "public-final";
  if (!isVisible && !(input.includePreview && settings.leaderboardVisibility === "preview")) {
    return {
      ok: true,
      value: {
        state: settings.state,
        visibility: settings.leaderboardVisibility,
        boardStatus,
        rows: [],
        teams: [],
      },
    };
  }
  const participants = (await listLeaderboardParticipants(input.eventSlug)).filter((participant) =>
    settings.publicRankingPolicy === "include"
      ? true
      : settings.publicRankingPolicy === "exclude-refunded"
        ? participant.status !== "refunded"
        : participant.status !== "disqualified",
  );
  const ranked = rankScores(
    participants.map((participant) => ({
      ...participant,
      publicAlias: leaderboardNameFor(settings.publicNames, participant),
    })),
  );
  const breakdowns = await listPublicScoreBreakdowns(input.eventSlug);
  return {
    ok: true,
    value: {
      state: settings.state,
      visibility: settings.leaderboardVisibility,
      boardStatus,
      teams: await listTeamLeaderboardTotals(input.eventSlug),
      rows: ranked.map((score) => ({
        rank: score.rank,
        publicAlias: score.displayMode === "anonymous" ? "Anonymous" : score.publicAlias,
        entryCode: score.participantId.slice(-6).toUpperCase(),
        points: score.balance,
        team: score.teamName,
        teamColourKey: score.teamColourKey,
        isCurrentAttendee: score.participantId === input.currentParticipantId,
        breakdown: breakdowns.get(score.participantId) ?? [],
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
      "id" | "publicAlias" | "displayMode" | "teamName" | "teamColourKey" | "status" | "checkedInAt"
    > &
      Pick<ScoreProjection, "balance" | "revision" | "lastTransactionAt">;
    rank: number;
    teamRank?: number;
    orderPoints: number;
    transactions: Array<{
      status: ScoreTransaction["status"];
      reasonCode: ScoreTransaction["reasonCode"];
      activityName?: string;
      sourceType: ScoreTransaction["sourceType"];
      points: number;
      createdAt: string;
    }>;
  }>
> {
  if (!(await isCapabilityEffective(input.eventSlug, "scoring"))) {
    return { ok: false, status: 404, error: "Scoring is not enabled" };
  }
  const settings = await findSettings(input.eventSlug);
  if (!settings || settings.state === "off") {
    return { ok: false, status: 404, error: "Scoring is not enabled" };
  }
  const participant = await participantForTicket(input.ticketId);
  if (!participant || participant.eventSlug !== input.eventSlug)
    return { ok: false, status: 404, error: "Ticket participant not found" };
  const ranked = rankScores(await listLeaderboardParticipants(input.eventSlug));
  const order = await ticketOrderSummaryForParticipant(input.eventSlug, participant.id);
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
      : await listParticipantScoreEntries(input.eventSlug, participant.id);
  return {
    ok: true,
    value: {
      participant: {
        id: participant.id,
        publicAlias: participant.publicAlias,
        displayMode: participant.displayMode,
        teamName: participant.teamName,
        teamColourKey: participant.teamColourKey,
        status: participant.status,
        checkedInAt: participant.checkedInAt,
        balance: participant.balance,
        revision: participant.revision,
        lastTransactionAt: participant.lastTransactionAt,
      },
      orderPoints: order.orderPoints,
      rank: current?.rank ?? ranked.length + 1,
      teamRank,
      transactions,
    },
  };
}

export async function adminParticipantScore(input: {
  eventSlug: string;
  participantId: string;
}): Promise<
  ScoringOperationResult<{
    participant: {
      id: string;
      name: string;
      publicAlias: string;
      points: number;
      teamName?: string;
    };
    transactions: Awaited<ReturnType<typeof listParticipantScoreEntries>>;
  }>
> {
  const participant = await getParticipant(input.participantId);
  if (!participant || participant.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Participant not found" };
  }
  return {
    ok: true,
    value: {
      participant: {
        id: participant.id,
        name: participant.displayName ?? participant.publicAlias,
        publicAlias: participant.publicAlias,
        points: participant.balance,
        teamName: participant.teamName,
      },
      transactions: await listParticipantScoreEntries(input.eventSlug, participant.id, 200),
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
  return transaction((client) => mergeParticipantsInTransaction(client, input));
}

export async function mergeParticipantsInTransaction(
  client: PoolClient,
  input: {
    eventSlug: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    actorId: string;
    reason: string;
    evidence: string[];
  },
): Promise<ScoringOperationResult<void>> {
  if (!input.reason.trim() || input.evidence.length === 0)
    return { ok: false, status: 400, error: "A merge needs evidence and a reason" };
  if (input.sourceParticipantId === input.targetParticipantId)
    return { ok: false, status: 400, error: "Choose two different participants" };
  await lockScoringProjection(client, input.eventSlug);
  const rows = await client.query<{
    id: string;
    event_slug: string;
    person_id: string | null;
    status: string;
  }>(
    `select id, event_slug, person_id, status from event_participants
          where id = any($1::text[])
          order by id
          for update`,
    [[input.sourceParticipantId, input.targetParticipantId]],
  );
  if (rows.rows.length !== 2 || rows.rows.some((row) => row.event_slug !== input.eventSlug)) {
    return { ok: false, status: 404, error: "Participants not found" };
  }
  if (rows.rows.some((row) => row.status !== "active")) {
    return { ok: false, status: 409, error: "Only active participants can be merged" };
  }
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
  await rebuildMergedProjections(client, input.eventSlug);
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
  return { ok: true, value: undefined };
}

export async function reverseParticipantMerge(input: {
  mergeId: string;
  actorId: string;
  reason: string;
}): Promise<ScoringOperationResult<void>> {
  if (!input.reason.trim()) return { ok: false, status: 400, error: "A split needs a reason" };
  return transaction(async (client) => {
    const selected = await client.query<{ event_slug: string }>(
      `select event_slug from event_participant_merges where id = $1`,
      [input.mergeId],
    );
    const eventSlug = selected.rows[0]?.event_slug;
    if (!eventSlug) return { ok: false, status: 404, error: "Merge not found" };
    await lockScoringProjection(client, eventSlug);
    const updated = await client.query<{ event_slug: string; source_participant_id: string }>(
      `update event_participant_merges
        set reversed_at = now(), reversed_by = $2, reversal_reason = $3
      where id = $1 and reversed_at is null
      returning event_slug, source_participant_id`,
      [input.mergeId, input.actorId, input.reason],
    );
    const row = updated.rows[0];
    if (!row) return { ok: false, status: 404, error: "Merge already reversed" };
    await client.query(
      `update event_participants set status = 'active', updated_at = now() where id = $1`,
      [row.source_participant_id],
    );
    await rebuildMergedProjections(client, row.event_slug);
    await client.query(
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
  });
}

async function lockScoringProjection(client: PoolClient, eventSlug: string): Promise<void> {
  await client.query(
    `insert into event_scoring_settings (event_slug) values ($1) on conflict (event_slug) do nothing`,
    [eventSlug],
  );
  await client.query(
    `select event_slug from event_scoring_settings where event_slug = $1 for update`,
    [eventSlug],
  );
}

async function rebuildMergedProjections(client: PoolClient, eventSlug: string): Promise<void> {
  await client.query(
    `with recursive participant_targets as (
       select id as source_id, id as target_id, array[id] as path
         from event_participants
        where event_slug = $1
       union all
       select targets.source_id, merges.target_participant_id, targets.path || merges.target_participant_id
         from participant_targets targets
         join event_participant_merges merges
           on merges.source_participant_id = targets.target_id
          and merges.reversed_at is null
        where not merges.target_participant_id = any(targets.path)
     ), resolved_targets as (
       select distinct on (source_id) source_id, target_id
         from participant_targets
        order by source_id, cardinality(path) desc
     ), accepted_balances as (
       select resolved.target_id as participant_id,
              coalesce(sum(postings.points), 0)::integer as balance,
              max(transactions.created_at) as last_transaction_at
         from score_postings postings
         join score_transactions transactions on transactions.id = postings.transaction_id
         join resolved_targets resolved on resolved.source_id = postings.participant_id
        where postings.event_slug = $1 and transactions.status = 'accepted'
        group by resolved.target_id
     )
     insert into score_projections
       (participant_id, event_slug, balance, revision, last_transaction_at, updated_at)
     select participants.id,
            participants.event_slug,
            coalesce(balances.balance, 0),
            settings.revision,
            balances.last_transaction_at,
            now()
       from event_participants participants
       join event_scoring_settings settings on settings.event_slug = participants.event_slug
       left join accepted_balances balances on balances.participant_id = participants.id
      where participants.event_slug = $1
     on conflict (participant_id) do update set
       balance = excluded.balance,
       revision = greatest(score_projections.revision + 1, excluded.revision),
       last_transaction_at = excluded.last_transaction_at,
       updated_at = excluded.updated_at`,
    [eventSlug],
  );
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
