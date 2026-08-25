import { randomUUID } from "node:crypto";

import { isValidTicketId, parseTicketQrPayload } from "@/features/tickets/types";
import { verifyTicketSignature } from "@/features/tickets/qr.server";
import { redeemTicket } from "@/features/tickets/tickets.server";
import { getEvent } from "@/features/events/store.server";
import { queryOne } from "@/lib/platform/postgres.server";
import {
  awardPoints,
  checkInForScoring,
  listScoringActivities,
  reversePoints,
  type ScoringOperationResult,
} from "./scoring.server";
import { hasStaffPermission, resolveStaffAccess } from "./staff.server";
import {
  getScoreTransaction,
  getParticipant,
  listPools,
  participantForTicket,
  searchEventParticipants,
  type StoredStaffAssignment,
} from "./store.server";
import { convertRulePoints, type ScoreParticipant, type ScoreTransaction } from "./types";

export type StaffScoringContext = {
  assignment: StoredStaffAssignment;
  deviceId: string;
};

export async function resolveStaffScoringContext(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
}): Promise<StaffScoringContext | null> {
  const assignment = await resolveStaffAccess({
    eventSlug: input.eventSlug,
    token: input.token,
    deviceId: input.deviceId,
  });
  return assignment ? { assignment, deviceId: input.deviceId } : null;
}

function scopeActivityIds(assignment: StoredStaffAssignment): string[] | null {
  const value = assignment.scope.activityIds;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
}

function canUseActivity(assignment: StoredStaffAssignment, activityId: string): boolean {
  const ids = scopeActivityIds(assignment);
  return ids === null || ids.includes(activityId);
}

function scopeBoolean(assignment: StoredStaffAssignment, key: string): boolean {
  return assignment.scope[key] === true;
}

function scopeNumber(assignment: StoredStaffAssignment, key: string, fallback: number): number {
  const value = assignment.scope[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function getStaffScoringPage(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
}): Promise<
  | { found: false }
  | {
      found: true;
      eventSlug: string;
      eventTitle: string;
      label: string;
      assignmentType: StoredStaffAssignment["assignmentType"];
      canAward: boolean;
      canAdmit: boolean;
      canTransfer: boolean;
      canReverse: boolean;
      canReviewHeld: boolean;
      activities: Awaited<ReturnType<typeof listScoringActivities>>;
      pools: Awaited<ReturnType<typeof listPools>>;
    }
> {
  const context = await resolveStaffScoringContext(input);
  if (!context) return { found: false };
  const { assignment } = context;
  const [event, activities, pools] = await Promise.all([
    getEvent(input.eventSlug),
    listScoringActivities(input.eventSlug),
    listPools(input.eventSlug),
  ]);
  if (!event) return { found: false };
  const stationId = assignment.assignmentType === "station" ? assignment.id : undefined;
  return {
    found: true,
    eventSlug: input.eventSlug,
    eventTitle: event.title,
    label: assignment.label,
    assignmentType: assignment.assignmentType,
    canAward: hasStaffPermission(assignment, "awardPoints"),
    canAdmit: hasStaffPermission(assignment, "admitTickets"),
    canTransfer: hasStaffPermission(assignment, "transferPoints"),
    canReverse: hasStaffPermission(assignment, "reverseAwards"),
    canReviewHeld: hasStaffPermission(assignment, "reviewHeldActions"),
    activities: activities.filter(
      (activity) => activity.status === "live" && canUseActivity(assignment, activity.id),
    ),
    pools: pools.filter(
      (pool) =>
        (pool.activityId !== undefined && canUseActivity(assignment, pool.activityId)) ||
        pool.ownerId === assignment.id ||
        (stationId !== undefined && pool.ownerId === stationId),
    ),
  };
}

export async function admitStaffTicket(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  scanned: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context || !hasStaffPermission(context.assignment, "admitTickets"))
    return { ok: false as const, status: 403, error: "This staff link cannot admit tickets" };
  const outcome = await redeemTicket({
    scanned: input.scanned,
    eventSlug: input.eventSlug,
    redeemedBy: context.assignment.label,
  });
  if (outcome.result === "admitted" && outcome.ticket) {
    const checkInActivity = (await listScoringActivities(input.eventSlug)).find(
      (activity) => activity.template === "check-in" && activity.status === "live",
    );
    await checkInForScoring({
      eventSlug: input.eventSlug,
      ticketId: outcome.ticket.id,
      idempotencyKey: `admission-${outcome.ticket.id}`,
      actorId: context.assignment.id,
      checkInPoints: checkInActivity?.rule.fixedPoints,
    });
  }
  return { ok: true as const, value: outcome };
}

export async function searchStaffParticipants(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  term: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context || !hasStaffPermission(context.assignment, "viewParticipantPoints")) return [];
  return searchEventParticipants(input.eventSlug, input.term);
}

export async function resolveStaffScannedParticipant(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  scanned: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context || !hasStaffPermission(context.assignment, "viewParticipantPoints")) return null;
  const participant = await participantFromScannedValue(input.eventSlug, input.scanned);
  return participant
    ? {
        id: participant.id,
        publicAlias: participant.publicAlias,
        displayName: participant.displayName,
        ticketSuffix: participant.ticketId?.slice(-8),
        balance: participant.balance,
        checkedIn: participant.checkedInAt !== undefined,
      }
    : null;
}

async function participantFromScannedValue(
  eventSlug: string,
  scanned: string,
): Promise<(ScoreParticipant & { balance: number }) | null> {
  const parsed = parseTicketQrPayload(scanned);
  const typed = scanned.trim().toUpperCase();
  const ticketId = parsed?.ticketId ?? (isValidTicketId(typed) ? typed : null);
  if (!ticketId || (parsed && !verifyTicketSignature(parsed.ticketId, parsed.signature)))
    return null;
  const participant = await participantForTicket(ticketId);
  return participant?.eventSlug === eventSlug ? participant : null;
}

export async function awardStaffPoints(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  activityId: string;
  participantId?: string;
  scanned?: string;
  placement?: number;
  rawScore?: number;
  points?: number;
  commandId: string;
  note?: string;
  confirmLarge?: boolean;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  const context = await resolveStaffScoringContext(input);
  if (!context || !hasStaffPermission(context.assignment, "awardPoints")) {
    return { ok: false, status: 403, error: "This staff link cannot award points" };
  }
  if (!canUseActivity(context.assignment, input.activityId)) {
    return { ok: false, status: 403, error: "This activity is outside this staff assignment" };
  }
  const activities = await listScoringActivities(input.eventSlug);
  const activity = activities.find((entry) => entry.id === input.activityId);
  if (!activity) return { ok: false, status: 404, error: "Activity not found" };
  if (input.points !== undefined && !scopeBoolean(context.assignment, "allowFreeformPoints")) {
    return { ok: false, status: 403, error: "Use the configured activity outcome" };
  }
  const participant = input.scanned
    ? await participantFromScannedValue(input.eventSlug, input.scanned)
    : input.participantId
      ? await getParticipant(input.participantId)
      : null;
  if (!participant || participant.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Participant not found" };
  }
  const points = input.points ?? convertRulePoints(activity.rule, input);
  const warningAt = Math.max(1, scopeNumber(context.assignment, "largeAwardWarningAt", 25));
  if (points >= warningAt && !input.confirmLarge) {
    return {
      ok: false,
      status: 409,
      error: `Confirm this ${points}-point award before you continue`,
    };
  }
  const pools = await listPools(input.eventSlug);
  const pool =
    pools.find((entry) => entry.activityId === activity.id) ??
    pools.find((entry) => entry.ownerId === context.assignment.id);
  if (!pool && !scopeBoolean(context.assignment, "unmetered")) {
    return { ok: false, status: 409, error: "This staff assignment has no points pool" };
  }
  return awardPoints({
    eventSlug: input.eventSlug,
    activityId: activity.id,
    participantIds: [participant.id],
    rawScore: input.rawScore,
    placement: input.placement,
    points: input.points,
    sourceId: `staff_${input.commandId}`,
    idempotencyKey: input.commandId,
    actorType: "staff",
    actorId: context.assignment.assignmentType === "personal" ? context.assignment.id : undefined,
    assignmentId: context.assignment.id,
    stationId: context.assignment.assignmentType === "station" ? context.assignment.id : undefined,
    deviceId: context.deviceId,
    note: input.note,
    poolId: pool?.id,
    allowOverride: input.points !== undefined,
  });
}

export async function reverseStaffAward(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  transactionId: string;
  commandId?: string;
  note: string;
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  const context = await resolveStaffScoringContext(input);
  if (!context || !hasStaffPermission(context.assignment, "reverseAwards")) {
    return { ok: false, status: 403, error: "This staff link cannot reverse awards" };
  }
  const transaction = await getScoreTransaction(input.transactionId);
  if (!transaction || transaction.eventSlug !== input.eventSlug) {
    return { ok: false, status: 404, error: "Award not found" };
  }
  const ownAudit = await queryOne<{ id: number }>(
    `select id from score_audit_events
        where event_slug = $1 and entity_type = 'score_transaction' and entity_id = $2
          and assignment_id = $3 limit 1`,
    [input.eventSlug, input.transactionId, context.assignment.id],
  );
  if (!ownAudit) return { ok: false, status: 403, error: "Staff can reverse only their own award" };
  return reversePoints({
    eventSlug: input.eventSlug,
    transactionId: input.transactionId,
    idempotencyKey: input.commandId ?? `staff-reverse-${randomUUID()}`,
    actorType: "staff",
    actorId: context.assignment.id,
    note: input.note,
  });
}
