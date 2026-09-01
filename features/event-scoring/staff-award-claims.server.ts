import { createHash, randomBytes, randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { awardPoints, type ScoringOperationResult } from "./scoring.server";
import { SCORE_ECONOMY, type ScoreActivity, type ScoreTransaction } from "./types";
import type { StoredStaffAssignment } from "./store.server";

type ClaimRow = {
  id: string;
  event_slug: string;
  assignment_id: string;
  activity_id: string;
  pool_id: string | null;
  points_override: number | null;
  note: string | null;
  status: string;
  participant_id: string | null;
  processing_started_at: Date | null;
  expires_at: Date;
  activity_name: string;
  activity_template: string;
  activity_rule: unknown;
  assignment_type: string;
  assignment_status: string;
  assignment_expires_at: Date | null;
};

export type StaffAwardClaimPreview = {
  eventSlug: string;
  activityName: string;
  points: number;
  requiresCheckIn: boolean;
  expiresAt: string;
  state: "active" | "claimed" | "expired" | "unavailable";
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function claimPoints(row: Pick<ClaimRow, "points_override" | "activity_rule">): number {
  if (row.points_override !== null) return row.points_override;
  const rule = row.activity_rule as ScoreActivity["rule"];
  return rule.mode === "participation" ? (rule.participationPoints ?? 0) : (rule.fixedPoints ?? 0);
}

export async function createStaffAwardClaim(input: {
  eventSlug: string;
  assignment: StoredStaffAssignment;
  activity: ScoreActivity;
  poolId?: string;
  deviceId: string;
  pointsOverride?: number;
  note?: string;
  expiresInSeconds: number;
}): Promise<
  ScoringOperationResult<{
    token: string;
    claimPath: string;
    activityName: string;
    points: number;
    expiresAt: string;
  }>
> {
  const expiresInSeconds = Math.min(180, Math.max(15, Math.trunc(input.expiresInSeconds)));
  const points =
    input.pointsOverride ??
    (input.activity.rule.mode === "participation"
      ? input.activity.rule.participationPoints
      : input.activity.rule.fixedPoints);
  if (!Number.isInteger(points) || !points || points < 1) {
    return { ok: false, status: 400, error: "This activity needs a fixed positive QR award" };
  }
  if (points > SCORE_ECONOMY.maximumSingleAward) {
    return {
      ok: false,
      status: 400,
      error: `One QR cannot award more than ${SCORE_ECONOMY.maximumSingleAward} points`,
    };
  }
  if (input.pointsOverride !== undefined && !input.note?.trim()) {
    return { ok: false, status: 400, error: "A custom QR award needs a reason" };
  }
  if (input.activity.template === "free-form" && !input.note?.trim()) {
    return { ok: false, status: 400, error: "A free-form QR award needs a reason" };
  }
  const token = `award_${randomBytes(24).toString("base64url")}`;
  const id = `sac_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1_000);
  await query(
    `insert into score_staff_award_claims
       (id,event_slug,assignment_id,activity_id,pool_id,token_hash,points_override,note,
        created_by_device_id,expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      input.eventSlug,
      input.assignment.id,
      input.activity.id,
      input.poolId ?? null,
      digest(token),
      input.pointsOverride ?? null,
      input.note?.trim() || null,
      input.deviceId,
      expiresAt,
    ],
  );
  return {
    ok: true,
    value: {
      token,
      claimPath: `/events/${encodeURIComponent(input.eventSlug)}/award/${encodeURIComponent(token)}`,
      activityName: input.activity.name,
      points,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

async function claimRow(token: string): Promise<ClaimRow | null> {
  await query(
    `update score_staff_award_claims
        set status = 'expired', updated_at = now()
      where token_hash = $1
        and expires_at <= now()
        and (
          status = 'active'
          or (status = 'processing' and processing_started_at < now() - interval '30 seconds')
        )`,
    [digest(token)],
  );
  return queryOne<ClaimRow>(
    `select claims.id,claims.event_slug,claims.assignment_id,claims.activity_id,claims.pool_id,
            claims.points_override,claims.note,claims.status,claims.participant_id,
            claims.processing_started_at,claims.expires_at,
            activities.name as activity_name,activities.template as activity_template,
            activities.rule as activity_rule,assignments.assignment_type,
            assignments.status as assignment_status,assignments.expires_at as assignment_expires_at
       from score_staff_award_claims claims
       join score_activities activities on activities.id = claims.activity_id
       join score_staff_assignments assignments on assignments.id = claims.assignment_id
      where claims.token_hash = $1`,
    [digest(token)],
  );
}

export async function getStaffAwardClaimPreview(
  eventSlug: string,
  token: string,
): Promise<StaffAwardClaimPreview | null> {
  const row = await claimRow(token);
  if (!row || row.event_slug !== eventSlug) return null;
  const state =
    row.status === "claimed"
      ? "claimed"
      : row.status === "expired" || row.expires_at.getTime() <= Date.now()
        ? "expired"
        : row.status === "active" || row.status === "processing"
          ? "active"
          : "unavailable";
  return {
    eventSlug,
    activityName: row.activity_name,
    points: claimPoints(row),
    requiresCheckIn: (row.activity_rule as ScoreActivity["rule"]).requiresCheckIn,
    expiresAt: row.expires_at.toISOString(),
    state,
  };
}

export async function claimStaffAward(input: {
  eventSlug: string;
  token: string;
  participantId: string;
}): Promise<ScoringOperationResult<{ transaction: ScoreTransaction; points: number }>> {
  const locked = await transaction(async (client) => {
    const selected = await client.query<ClaimRow>(
      `select claims.id,claims.event_slug,claims.assignment_id,claims.activity_id,claims.pool_id,
              claims.points_override,claims.note,claims.status,claims.participant_id,
              claims.processing_started_at,claims.expires_at,
              activities.name as activity_name,activities.template as activity_template,
              activities.rule as activity_rule,assignments.assignment_type,
              assignments.status as assignment_status,assignments.expires_at as assignment_expires_at
         from score_staff_award_claims claims
         join score_activities activities on activities.id = claims.activity_id
         join score_staff_assignments assignments on assignments.id = claims.assignment_id
        where claims.token_hash = $1 for update of claims`,
      [digest(input.token)],
    );
    const claim = selected.rows[0];
    if (!claim || claim.event_slug !== input.eventSlug) return null;
    const staleProcessing =
      claim.status === "processing" &&
      Boolean(
        claim.processing_started_at && claim.processing_started_at.getTime() < Date.now() - 30_000,
      );
    if (
      claim.expires_at.getTime() <= Date.now() &&
      (claim.status === "active" || staleProcessing)
    ) {
      await client.query(
        `update score_staff_award_claims set status = 'expired',updated_at = now() where id = $1`,
        [claim.id],
      );
      return { row: { ...claim, status: "expired" }, acquired: false };
    }
    if (
      (claim.status !== "active" && !staleProcessing) ||
      claim.assignment_status !== "active" ||
      (claim.assignment_expires_at && claim.assignment_expires_at.getTime() <= Date.now())
    ) {
      return { row: claim, acquired: false };
    }
    if (staleProcessing && claim.participant_id !== input.participantId) {
      return { row: claim, acquired: false };
    }
    await client.query(
      `update score_staff_award_claims
          set status = 'processing',participant_id = $2,processing_started_at = now(),updated_at = now()
        where id = $1`,
      [claim.id, input.participantId],
    );
    return {
      row: {
        ...claim,
        participant_id: input.participantId,
        processing_started_at: new Date(),
        status: "processing",
      },
      acquired: true,
    };
  });
  if (!locked) return { ok: false, status: 404, error: "Award QR not found" };
  const { row } = locked;
  if (row.status === "claimed") {
    return { ok: false, status: 409, error: "Those points have already been claimed" };
  }
  if (!locked.acquired && row.status === "processing") {
    return { ok: false, status: 409, error: "Those points are being claimed already" };
  }
  if (!locked.acquired && row.status === "active") {
    return { ok: false, status: 410, error: "This award QR is no longer available" };
  }
  if (row.status !== "processing" || row.expires_at.getTime() <= Date.now()) {
    return { ok: false, status: 410, error: "This award QR has expired" };
  }
  const pointsOverride = row.points_override ?? undefined;
  const scored = await awardPoints({
    eventSlug: input.eventSlug,
    activityId: row.activity_id,
    participantIds: [input.participantId],
    points: pointsOverride,
    sourceId: `award_claim_${row.id}`,
    idempotencyKey: `award-claim:${row.id}`,
    actorType: "staff",
    actorId: row.assignment_type === "personal" ? row.assignment_id : undefined,
    assignmentId: row.assignment_id,
    stationId: row.assignment_type === "station" ? row.assignment_id : undefined,
    note: row.note ?? undefined,
    poolId: row.pool_id ?? undefined,
    allowOverride: pointsOverride !== undefined,
  });
  if (!scored.ok) {
    await query(
      `update score_staff_award_claims
          set status = case when expires_at > now() then 'active' else 'expired' end,
              participant_id = null,processing_started_at = null,updated_at = now()
        where id = $1 and status = 'processing'`,
      [row.id],
    );
    return scored;
  }
  await query(
    `update score_staff_award_claims
        set status = 'claimed',transaction_id = $2,claimed_at = now(),updated_at = now()
      where id = $1 and status = 'processing'`,
    [row.id, scored.value.id],
  );
  return { ok: true, value: { transaction: scored.value, points: claimPoints(row) } };
}
