import { query, queryOne } from "@/lib/platform/postgres.server";
import type {
  ActivityStatus,
  ActivityTemplate,
  ScoreActivity,
  ScoreRule,
  ScoringSettings,
} from "../types";
import {
  id,
  toActivity,
  toSettings,
  type ActivityRow,
  type ScoringSettingsRow,
} from "./common.server";

export async function findSettings(eventSlug: string): Promise<ScoringSettings | null> {
  const row = await queryOne<ScoringSettingsRow>(
    `select * from event_scoring_settings where event_slug = $1`,
    [eventSlug],
  );
  return row ? toSettings(row) : null;
}

export async function getOrCreateSettings(eventSlug: string): Promise<ScoringSettings> {
  await query(
    `insert into event_scoring_settings (event_slug) values ($1) on conflict (event_slug) do nothing`,
    [eventSlug],
  );
  const row = await queryOne<ScoringSettingsRow>(
    `select * from event_scoring_settings where event_slug = $1`,
    [eventSlug],
  );
  if (!row) throw new Error("Event scoring settings could not be created");
  return toSettings(row);
}

export async function updateSettings(
  eventSlug: string,
  changes: Partial<
    Pick<
      ScoringSettings,
      | "state"
      | "leaderboardVisibility"
      | "scheduledStart"
      | "scheduledEnd"
      | "allowPreCheckinOnlinePoints"
      | "publicNames"
      | "publicRankingPolicy"
      | "photoConsentPolicy"
      | "allowStaffSelfAwards"
    >
  >,
): Promise<ScoringSettings> {
  const row = await queryOne<ScoringSettingsRow>(
    `update event_scoring_settings
        set state = coalesce($2, state),
            leaderboard_visibility = coalesce($3, leaderboard_visibility),
            scheduled_start = coalesce($4::timestamptz, scheduled_start),
            scheduled_end = coalesce($5::timestamptz, scheduled_end),
            allow_precheckin_online_points = coalesce($6, allow_precheckin_online_points),
            public_names = coalesce($7, public_names),
            public_ranking_policy = coalesce($8, public_ranking_policy),
            photo_consent_policy = coalesce($9, photo_consent_policy),
            allow_staff_self_awards = coalesce($10, allow_staff_self_awards),
            revision = revision + 1,
            updated_at = now()
      where event_slug = $1
      returning *`,
    [
      eventSlug,
      changes.state ?? null,
      changes.leaderboardVisibility ?? null,
      changes.scheduledStart ?? null,
      changes.scheduledEnd ?? null,
      changes.allowPreCheckinOnlinePoints ?? null,
      changes.publicNames ?? null,
      changes.publicRankingPolicy ?? null,
      changes.photoConsentPolicy ?? null,
      changes.allowStaffSelfAwards ?? null,
    ],
  );
  if (!row) throw new Error("Event scoring settings not found");
  return toSettings(row);
}

export async function createActivity(input: {
  eventSlug: string;
  name: string;
  template: ActivityTemplate;
  rule: ScoreRule;
  status?: ActivityStatus;
  startsAt?: string;
  endsAt?: string;
  createdBy?: string;
}): Promise<ScoreActivity> {
  const activityId = id("act");
  const row = await queryOne<ActivityRow>(
    `insert into score_activities
       (id, event_slug, name, template, status, rule, starts_at, ends_at, created_by)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
     returning *, null::text as pool_id`,
    [
      activityId,
      input.eventSlug,
      input.name.trim(),
      input.template,
      input.status ?? "draft",
      JSON.stringify(input.rule),
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.createdBy ?? null,
    ],
  );
  if (!row) throw new Error("Activity could not be created");
  return toActivity(row);
}

export async function getActivity(activityId: string): Promise<ScoreActivity | null> {
  const row = await queryOne<ActivityRow>(
    `select a.*, p.id as pool_id
       from score_activities a
       left join score_pools p on p.activity_id = a.id
      where a.id = $1`,
    [activityId],
  );
  return row ? toActivity(row) : null;
}

export async function updateActivity(
  activityId: string,
  changes: Partial<Pick<ScoreActivity, "name" | "status" | "startsAt" | "endsAt">> & {
    rule?: ScoreRule;
  },
): Promise<ScoreActivity | null> {
  const row = await queryOne<ActivityRow>(
    `update score_activities
        set name = coalesce($2, name),
            status = coalesce($3, status),
            starts_at = coalesce($4::timestamptz, starts_at),
            ends_at = coalesce($5::timestamptz, ends_at),
            rule = coalesce($6::jsonb, rule),
            rule_revision = case when $6 is null then rule_revision else rule_revision + 1 end,
            updated_at = now()
      where id = $1
      returning *, null::text as pool_id`,
    [
      activityId,
      changes.name ?? null,
      changes.status ?? null,
      changes.startsAt ?? null,
      changes.endsAt ?? null,
      changes.rule ? JSON.stringify(changes.rule) : null,
    ],
  );
  return row ? toActivity(row) : null;
}

export async function listActivities(eventSlug: string): Promise<ScoreActivity[]> {
  const rows = await query<ActivityRow>(
    `select a.*, p.id as pool_id
       from score_activities a
       left join score_pools p on p.activity_id = a.id
      where a.event_slug = $1
      order by a.created_at desc, a.id`,
    [eventSlug],
  );
  return rows.map(toActivity);
}
