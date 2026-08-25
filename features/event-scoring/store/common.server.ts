import { randomUUID, createHash } from "node:crypto";
import type {
  ActivityStatus,
  ActivityTemplate,
  LeaderboardVisibility,
  ScoreActivity,
  ScoreParticipant,
  ScorePosting,
  ScoreProjection,
  ScoreRule,
  ScoreTransaction,
  ScoringSettings,
  ScoringState,
  ScoreSourceType,
  ScoreReasonCode,
  ScoreTransactionStatus,
  StaffAssignmentStatus,
  StaffAssignmentType,
  StaffPermissionSet,
} from "../types";

export type ScoreStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export type ScoringSettingsRow = {
  event_slug: string;
  state: string;
  leaderboard_visibility: string;
  scheduled_start: Date | null;
  scheduled_end: Date | null;
  allow_precheckin_online_points: boolean;
  public_names: string;
  public_ranking_policy: string;
  photo_consent_policy: string;
  allow_staff_self_awards: boolean;
  revision: string | number;
};

export type ActivityRow = {
  id: string;
  event_slug: string;
  name: string;
  template: string;
  status: string;
  rule: unknown;
  rule_revision: number;
  starts_at: Date | null;
  ends_at: Date | null;
  pool_id?: string | null;
};

export type ParticipantRow = {
  id: string;
  event_slug: string;
  person_id: string | null;
  ticket_id: string | null;
  generated_alias: string;
  chosen_alias: string | null;
  canonical_name?: string | null;
  display_mode: "alias" | "anonymous" | "hidden";
  display_name: string | null;
  status: string;
  checked_in_at: Date | null;
  balance: number;
  projection_revision: string | number;
  last_transaction_at: Date | null;
  team_id: string | null;
  team_name: string | null;
};

export type TransactionRow = {
  id: string;
  event_slug: string;
  activity_id: string | null;
  source_type: string;
  source_id: string;
  idempotency_key: string;
  status: string;
  reason_code: string;
  note: string | null;
  rule_revision: number | null;
  actor_type: string;
  actor_id: string | null;
  station_id: string | null;
  device_id: string | null;
  metadata?: unknown;
  created_at: Date;
};

export type PostingRow = {
  participant_id: string;
  points: number;
  team_id: string | null;
};

export type StaffAssignmentRow = {
  id: string;
  event_slug: string;
  label: string;
  assignment_type: string;
  permissions: unknown;
  scope: unknown;
  status: string;
  expires_at: Date | null;
  revoked_at: Date | null;
};

export type StoredStaffAssignment = {
  id: string;
  eventSlug: string;
  label: string;
  assignmentType: StaffAssignmentType;
  permissions: StaffPermissionSet;
  scope: Record<string, unknown>;
  status: StaffAssignmentStatus;
  expiresAt?: string;
  revokedAt?: string;
};

export type StoredStaffDevice = {
  assignmentId: string;
  deviceId: string;
  lastSeenAt: string;
  revokedAt?: string;
};

export type RecordScoreInput = {
  eventSlug: string;
  activityId?: string;
  sourceType: ScoreSourceType;
  sourceId: string;
  idempotencyKey: string;
  status?: ScoreTransactionStatus;
  reasonCode: ScoreReasonCode;
  note?: string;
  ruleRevision?: number;
  actorType: "system" | "admin" | "staff" | "attendee";
  actorId?: string;
  assignmentId?: string;
  stationId?: string;
  deviceId?: string;
  originalTransactionId?: string;
  metadata?: Record<string, unknown>;
  postings: ScorePosting[];
  poolId?: string;
};

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function iso(value: Date | null): string | undefined {
  return value?.toISOString();
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function recordObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

export function toSettings(row: ScoringSettingsRow): ScoringSettings {
  return {
    eventSlug: row.event_slug,
    state: textValue(row.state, "off") as ScoringState,
    leaderboardVisibility: textValue(row.leaderboard_visibility, "hidden") as LeaderboardVisibility,
    scheduledStart: iso(row.scheduled_start),
    scheduledEnd: iso(row.scheduled_end),
    allowPreCheckinOnlinePoints: row.allow_precheckin_online_points,
    publicNames: textValue(row.public_names, "generated") as ScoringSettings["publicNames"],
    publicRankingPolicy: textValue(
      row.public_ranking_policy,
      "exclude-refunded",
    ) as ScoringSettings["publicRankingPolicy"],
    photoConsentPolicy: textValue(
      row.photo_consent_policy,
      "ask",
    ) as ScoringSettings["photoConsentPolicy"],
    allowStaffSelfAwards: row.allow_staff_self_awards,
    revision: Number(row.revision),
  };
}

export function toActivity(row: ActivityRow): ScoreActivity {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    name: row.name,
    template: row.template as ActivityTemplate,
    status: row.status as ActivityStatus,
    rule: recordObject(row.rule) as unknown as ScoreRule,
    ruleRevision: row.rule_revision,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    pointPoolId: row.pool_id ?? undefined,
  };
}

export function toParticipant(
  row: ParticipantRow,
): ScoreParticipant & ScoreProjection & { teamId?: string } {
  return {
    id: row.id,
    participantId: row.id,
    eventSlug: row.event_slug,
    personId: row.person_id ?? undefined,
    ticketId: row.ticket_id ?? undefined,
    generatedAlias: row.generated_alias,
    chosenAlias: row.chosen_alias ?? undefined,
    canonicalName: row.canonical_name ?? undefined,
    publicAlias: row.chosen_alias ?? row.generated_alias,
    displayMode: row.display_mode,
    displayName: row.display_name ?? undefined,
    status: row.status as ScoreParticipant["status"],
    checkedInAt: iso(row.checked_in_at),
    balance: row.balance,
    revision: Number(row.projection_revision),
    lastTransactionAt: iso(row.last_transaction_at),
    teamId: row.team_id ?? undefined,
    teamName: row.team_name ?? undefined,
  };
}

export function toTransaction(row: TransactionRow, postings: ScorePosting[]): ScoreTransaction {
  return {
    id: row.id,
    eventSlug: row.event_slug,
    activityId: row.activity_id ?? undefined,
    sourceType: row.source_type as ScoreSourceType,
    sourceId: row.source_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as ScoreTransactionStatus,
    reasonCode: row.reason_code as ScoreReasonCode,
    note: row.note ?? undefined,
    ruleRevision: row.rule_revision ?? undefined,
    actorType: row.actor_type as ScoreTransaction["actorType"],
    actorId: row.actor_id ?? undefined,
    stationId: row.station_id ?? undefined,
    deviceId: row.device_id ?? undefined,
    metadata: recordObject(row.metadata),
    createdAt: row.created_at.toISOString(),
    postings,
  };
}

export function hashStaffToken(token: string): string {
  return hash(token);
}
