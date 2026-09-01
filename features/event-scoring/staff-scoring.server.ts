import { randomUUID } from "node:crypto";

import { isValidTicketId, parseTicketQrPayload } from "@/features/tickets/types";
import { verifyTicketSignature } from "@/features/tickets/qr.server";
import { redeemTicket } from "@/features/tickets/tickets.server";
import { issueTickets } from "@/features/tickets/tickets.server";
import { checkpointScan, listCheckpoints } from "@/features/tickets/checkpoints.server";
import {
  createGuestRequest,
  decideGuestRequest,
  listGuestRequests,
  listGuestRequestsForToken,
} from "@/features/tickets/guest-requests.server";
import { getEvent } from "@/features/events/store.server";
import {
  cancelEventDropSchedule,
  disableEventDrop,
  enableEventDrop,
  getEventDrop,
} from "@/features/events/drop.server";
import { isCapabilityEffective } from "@/features/attendee-operations/capabilities.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import {
  awardPoints,
  transferPoints,
  checkInForScoring,
  listScoringActivities,
  reversePoints,
  getScoring,
  type ScoringOperationResult,
} from "./scoring.server";
import {
  hasStaffPermission,
  resolveStaffAccess,
  staffAssignmentForPermission,
  type ResolvedStaffAccess,
} from "./staff.server";
import {
  getScoreTransaction,
  acceptHeldScore,
  createScoreMediaLink,
  getParticipant,
  listPools,
  listHeldScoreTransactions,
  listCheckedInTeamParticipants,
  listTeams,
  setTeamMembership,
  shuffleCheckedInTeams,
  participantForTicket,
  participantIdsInTicketOrder,
  ticketOrderSummaryForParticipant,
  searchEventParticipants,
  type StoredStaffAssignment,
} from "./store.server";
import {
  SCORE_ECONOMY,
  convertRulePoints,
  type ScoreParticipant,
  type ScoreTransaction,
} from "./types";
import { recordScoringOperationalEvent } from "./operations.server";
import { createStaffAwardClaim } from "./staff-award-claims.server";

export type StaffScoringContext = {
  access: ResolvedStaffAccess;
  /** First grant is display-only. Actions must choose an authorising grant. */
  assignment: StoredStaffAssignment;
  deviceId: string;
};

export async function resolveStaffScoringContext(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
}): Promise<StaffScoringContext | null> {
  const access = await resolveStaffAccess({
    eventSlug: input.eventSlug,
    token: input.token,
    deviceId: input.deviceId,
  });
  const assignment = access?.assignments[0];
  return assignment ? { access, assignment, deviceId: input.deviceId } : null;
}

function scopeActivityIds(assignment: StoredStaffAssignment): string[] | null {
  const value = assignment.scope.activityIds;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : null;
}

function canUseActivity(assignment: StoredStaffAssignment, activityId: string): boolean {
  const ids = scopeActivityIds(assignment);
  return ids === null || ids.includes(activityId);
}

function canUseCheckpoint(assignment: StoredStaffAssignment, checkpointId: string): boolean {
  const value = assignment.scope.checkpointIds;
  return !Array.isArray(value) || value.length === 0 || value.includes(checkpointId);
}

function assignmentFor(
  context: StaffScoringContext | null,
  permission: Parameters<typeof staffAssignmentForPermission>[1],
  activityId?: string,
): StoredStaffAssignment | null {
  return staffAssignmentForPermission(
    context?.access ?? null,
    permission,
    activityId ? (assignment) => canUseActivity(assignment, activityId) : undefined,
  );
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
      personId?: string;
      rolePreset?: string;
      expiresAt?: string;
      assignmentType: StoredStaffAssignment["assignmentType"];
      canAward: boolean;
      canManageTeams: boolean;
      canFreeform: boolean;
      maxPointsPerAward: number;
      offlineBudgetByActivity: Record<string, number>;
      canAdmit: boolean;
      canScanCheckpoints: boolean;
      canTransfer: boolean;
      canReverse: boolean;
      canReviewHeld: boolean;
      canUploadMedia: boolean;
      canManageGuestPhotos: boolean;
      guestPhotosAvailable: boolean;
      photoConsentPolicy: "ask" | "required" | "not-required";
      mediaDrop?: { uploadPath?: string; albumPath: string; expiresAt: string };
      canRun: boolean;
      canRequestGuests: boolean;
      canAddGuests: boolean;
      canApproveGuests: boolean;
      pinnedActivityIds: string[];
      recentAwards: Array<{
        id: string;
        participantLabel: string;
        activityName: string;
        points: number;
        createdAt: string;
        reversible: boolean;
      }>;
      guestRequests: Awaited<ReturnType<typeof listGuestRequests>>;
      heldActions: Array<{
        id: string;
        reasonCode: string;
        sourceType: string;
        createdAt: string;
      }>;
      recentParticipants: Array<{
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
        recentReason: "scan" | "award";
      }>;
      activities: Awaited<ReturnType<typeof listScoringActivities>>;
      checkpoints: Awaited<ReturnType<typeof listCheckpoints>>;
      pools: Awaited<ReturnType<typeof listPools>>;
      teams: Awaited<ReturnType<typeof listTeams>>;
      teamRoster: Awaited<ReturnType<typeof listCheckedInTeamParticipants>>;
    }
> {
  const context = await resolveStaffScoringContext(input);
  if (!context) return { found: false };
  const { assignment, access } = context;
  const assignments = access.assignments;
  const grant = (permission: Parameters<typeof staffAssignmentForPermission>[1]) =>
    staffAssignmentForPermission(access, permission);
  const canApproveGuests = grant("approveRequests") !== null;
  const canViewEmail = grant("resolveIdentity") !== null || grant("manageStaffAndPools") !== null;
  const [
    event,
    activities,
    pools,
    recentAwards,
    settings,
    drop,
    guestRequests,
    heldActions,
    recentParticipants,
    teams,
    teamRoster,
    checkpoints,
    guestPhotosAvailable,
  ] = await Promise.all([
    getEvent(input.eventSlug),
    listScoringActivities(input.eventSlug),
    listPools(input.eventSlug),
    Promise.all(assignments.map((entry) => listOwnRecentAwards(input.eventSlug, entry.id))).then(
      (entries) =>
        entries
          .flat()
          .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 12),
    ),
    getScoring(input.eventSlug),
    getEventDrop(input.eventSlug),
    canApproveGuests
      ? listGuestRequests(input.eventSlug, "pending")
      : Promise.all(
          assignments.map((entry) => listGuestRequestsForToken(`staff:${entry.id}`)),
        ).then((entries) => entries.flat()),
    grant("reviewHeldActions") ? listHeldScoreTransactions(input.eventSlug) : [],
    Promise.all(
      assignments.map((entry) =>
        listRecentStaffParticipants(input.eventSlug, entry.id, entry.label, canViewEmail),
      ),
    ).then((entries) => {
      const unique = new Map(entries.flat().map((entry) => [entry.id, entry]));
      return [...unique.values()].slice(0, 12);
    }),
    grant("manageTeams") ? listTeams(input.eventSlug) : [],
    grant("manageTeams") ? listCheckedInTeamParticipants(input.eventSlug) : [],
    listCheckpoints(input.eventSlug),
    isCapabilityEffective(input.eventSlug, "guestPhotos"),
  ]);
  if (!event) return { found: false };
  const stationId = assignment.assignmentType === "station" ? assignment.id : undefined;
  const awardingAssignments = assignments.filter((entry) =>
    hasStaffPermission(entry, "awardPoints"),
  );
  const maxPointsPerAward = awardingAssignments.length
    ? Math.min(
        SCORE_ECONOMY.maximumSingleAward,
        ...awardingAssignments.map((entry) =>
          Math.max(
            1,
            Math.trunc(scopeNumber(entry, "maxPointsPerAward", SCORE_ECONOMY.maximumSingleAward)),
          ),
        ),
      )
    : SCORE_ECONOMY.maximumSingleAward;
  return {
    found: true,
    eventSlug: input.eventSlug,
    eventTitle: event.title,
    label: assignments.map((entry) => entry.label).join(" · "),
    personId: assignment.personId,
    rolePreset:
      typeof assignment.scope.rolePreset === "string" ? assignment.scope.rolePreset : undefined,
    expiresAt: assignment.expiresAt,
    assignmentType: assignment.assignmentType,
    canAward: grant("awardPoints") !== null,
    canManageTeams: grant("manageTeams") !== null,
    canFreeform: assignments.some(
      (entry) =>
        hasStaffPermission(entry, "awardPoints") && scopeBoolean(entry, "allowFreeformPoints"),
    ),
    maxPointsPerAward,
    canAdmit: grant("admitTickets") !== null,
    canScanCheckpoints: grant("scanCheckpoints") !== null,
    canTransfer: grant("transferPoints") !== null,
    canReverse: grant("reverseAwards") !== null,
    canReviewHeld: grant("reviewHeldActions") !== null,
    canUploadMedia: grant("uploadActivityPhotos") !== null,
    canManageGuestPhotos: grant("manageGuestPhotos") !== null,
    guestPhotosAvailable,
    photoConsentPolicy: settings.photoConsentPolicy,
    mediaDrop: drop
      ? {
          uploadPath: drop.live ? `/drop/${drop.token}` : undefined,
          albumPath: `/t/${drop.transferId}`,
          expiresAt: drop.expiresAt,
        }
      : undefined,
    canRun: grant("runActivities") !== null,
    canRequestGuests: grant("requestGuests") !== null,
    canAddGuests: grant("addGuests") !== null,
    canApproveGuests,
    guestRequests,
    heldActions: heldActions.map((action) => ({
      id: action.id,
      reasonCode: action.reasonCode,
      sourceType: action.sourceType,
      createdAt: action.createdAt,
    })),
    recentParticipants,
    teams,
    teamRoster,
    pinnedActivityIds: Array.isArray(assignment.scope.pinnedActivityIds)
      ? assignment.scope.pinnedActivityIds.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    recentAwards: recentAwards.map((entry) => ({
      ...entry,
      reversible:
        entry.reversible &&
        grant("reverseAwards") !== null &&
        Date.now() - Date.parse(entry.createdAt) <= 15 * 60 * 1_000,
    })),
    activities: activities.filter(
      (activity) =>
        activity.status === "live" &&
        assignments.some(
          (entry) =>
            (hasStaffPermission(entry, "awardPoints") ||
              hasStaffPermission(entry, "runActivities")) &&
            canUseActivity(entry, activity.id),
        ),
    ),
    checkpoints: checkpoints.filter((checkpoint) =>
      assignments.some(
        (entry) =>
          hasStaffPermission(entry, "scanCheckpoints") && canUseCheckpoint(entry, checkpoint.id),
      ),
    ),
    pools: pools.filter(
      (pool) =>
        (pool.activityId !== undefined &&
          assignments.some((entry) => canUseActivity(entry, pool.activityId!))) ||
        assignments.some((entry) => pool.ownerId === entry.id) ||
        (stationId !== undefined && pool.ownerId === stationId),
    ),
    offlineBudgetByActivity: Object.fromEntries(
      activities.flatMap((activity) => {
        const offlineAssignment = awardingAssignments.find(
          (entry) => canUseActivity(entry, activity.id) && !scopeBoolean(entry, "unmetered"),
        );
        if (!offlineAssignment) return [];
        return [
          [
            activity.id,
            Math.min(
              50,
              Math.max(1, Math.trunc(scopeNumber(offlineAssignment, "offlineBudgetMax", 50))),
            ),
          ],
        ];
      }),
    ),
  };
}

export async function setStaffGuestPhotos(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  enabled: boolean;
  expirySeconds?: number;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "manageGuestPhotos");
  if (!context || !assignment) {
    return { ok: false as const, status: 403, error: "This staff role cannot manage photos" };
  }
  if (!(await isCapabilityEffective(input.eventSlug, "guestPhotos"))) {
    return {
      ok: false as const,
      status: 409,
      error: "Guest photos are disabled in the event settings. Ask an admin to enable them.",
    };
  }
  await cancelEventDropSchedule(input.eventSlug);
  const result = input.enabled
    ? await enableEventDrop(input.eventSlug, input.expirySeconds ?? 7 * 24 * 60 * 60)
    : await disableEventDrop(input.eventSlug);
  if (!result.ok) return result;
  await query(
    `insert into score_audit_events
       (event_slug,action,actor_type,actor_id,assignment_id,device_id,entity_type,entity_id,metadata)
     values ($1,'event.photos.toggled','staff',$2,$2,$3,'event',$1,$4::jsonb)`,
    [input.eventSlug, assignment.id, context.deviceId, JSON.stringify({ enabled: input.enabled })],
  );
  return { ok: true as const, value: await getEventDrop(input.eventSlug) };
}

async function currentStaffTeamState(eventSlug: string) {
  const [teams, teamRoster] = await Promise.all([
    listTeams(eventSlug),
    listCheckedInTeamParticipants(eventSlug),
  ]);
  return { teams, teamRoster };
}

export async function shuffleStaffTeams(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  teamCount: number;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "manageTeams");
  if (!context || !assignment) {
    return { ok: false as const, status: 403, error: "This staff link cannot manage teams" };
  }
  const shuffled = await shuffleCheckedInTeams({
    eventSlug: input.eventSlug,
    teamCount: input.teamCount,
    actorType: "staff",
    actorId: assignment.id,
    assignmentId: assignment.id,
    deviceId: context.deviceId,
  });
  return shuffled.ok
    ? { ok: true as const, value: await currentStaffTeamState(input.eventSlug) }
    : shuffled;
}

export async function moveStaffTeamParticipant(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  participantId: string;
  teamId: string;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "manageTeams");
  if (!context || !assignment) {
    return { ok: false as const, status: 403, error: "This staff link cannot manage teams" };
  }
  const eligible = await queryOne<{ participant: boolean; team: boolean }>(
    `select
       exists(select 1 from event_participants
               where id = $2 and event_slug = $1 and status = 'active'
                 and checked_in_at is not null) as participant,
       exists(select 1 from score_teams
               where id = $3 and event_slug = $1 and status = 'active') as team`,
    [input.eventSlug, input.participantId, input.teamId],
  );
  if (!eligible?.participant) {
    return { ok: false as const, status: 409, error: "That attendee is not checked in" };
  }
  if (!eligible.team) return { ok: false as const, status: 404, error: "Team not found" };
  const membership = await setTeamMembership({
    eventSlug: input.eventSlug,
    participantId: input.participantId,
    teamId: input.teamId,
  });
  if (!membership.ok) return membership;
  await query(
    `insert into score_audit_events
       (event_slug,action,actor_type,actor_id,assignment_id,device_id,
        entity_type,entity_id,metadata)
     values ($1,'teams.member.moved','staff',$2,$2,$3,'participant',$4,$5::jsonb)`,
    [
      input.eventSlug,
      assignment.id,
      context.deviceId,
      input.participantId,
      JSON.stringify({ teamId: input.teamId }),
    ],
  );
  return { ok: true as const, value: await currentStaffTeamState(input.eventSlug) };
}

export async function submitStaffGuest(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  name: string;
  note?: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context) return { ok: false as const, status: 403, error: "Staff access has expired" };
  const name = input.name.trim();
  if (!name) return { ok: false as const, status: 400, error: "Enter the guest name" };
  const addAssignment = assignmentFor(context, "addGuests");
  if (addAssignment) {
    const event = await getEvent(input.eventSlug);
    const ticketTypeId =
      event?.ticketTypes.find((type) => !type.hidden)?.id ?? event?.ticketTypes[0]?.id;
    if (!ticketTypeId)
      return { ok: false as const, status: 409, error: "No ticket type can accept a guest" };
    const issued = await issueTickets({
      eventSlug: input.eventSlug,
      ticketTypeId,
      holderName: name,
      quantity: 1,
      kind: "comp",
      notes: `added by ${addAssignment.label}`,
      bypassSalesWindow: true,
      bypassCapacity: true,
    });
    return issued.ok
      ? { ok: true as const, value: { mode: "added" as const, name } }
      : { ok: false as const, status: issued.status, error: issued.error };
  }
  const requestAssignment = assignmentFor(context, "requestGuests");
  if (!requestAssignment)
    return { ok: false as const, status: 403, error: "This staff link cannot request guests" };
  const requested = await createGuestRequest({
    eventSlug: input.eventSlug,
    token: `staff:${requestAssignment.id}`,
    requestedBy: requestAssignment.label,
    name,
    note: input.note,
  });
  return requested.ok
    ? { ok: true as const, value: { mode: "requested" as const, name } }
    : requested;
}

export async function decideStaffGuestRequest(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  requestId: number;
  approve: boolean;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "approveRequests");
  if (!context || !assignment)
    return { ok: false as const, status: 403, error: "This staff link cannot approve guests" };
  return decideGuestRequest({
    eventSlug: input.eventSlug,
    id: input.requestId,
    approve: input.approve,
    decidedBy: assignment.label,
  });
}

export async function transferStaffPoints(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  fromParticipantId: string;
  toParticipantId: string;
  points: number;
  commandId: string;
  note: string;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "transferPoints");
  if (!context || !assignment)
    return { ok: false as const, status: 403, error: "This staff link cannot transfer points" };
  return transferPoints({
    eventSlug: input.eventSlug,
    fromParticipantId: input.fromParticipantId,
    toParticipantId: input.toParticipantId,
    points: input.points,
    idempotencyKey: input.commandId,
    actorType: "staff",
    actorId: assignment.id,
    note: input.note,
  });
}

export async function acceptStaffHeldAction(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  transactionId: string;
  note: string;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "reviewHeldActions");
  if (!context || !assignment)
    return { ok: false as const, status: 403, error: "This staff link cannot review held work" };
  return acceptHeldScore(input.eventSlug, input.transactionId, {
    actorType: "staff",
    actorId: assignment.id,
    note: input.note,
  });
}

async function listOwnRecentAwards(eventSlug: string, assignmentId: string) {
  const rows = await query<{
    id: string;
    participant_label: string;
    activity_name: string;
    points: number;
    created_at: Date;
    reversed: boolean;
  }>(
    `select transactions.id,
            coalesce(participants.display_name, participants.chosen_alias,
                     participants.generated_alias) as participant_label,
            activities.name as activity_name,
            postings.points,
            transactions.created_at,
            exists (select 1 from score_transactions reversal
                     where reversal.original_transaction_id = transactions.id) as reversed
       from score_audit_events audit
       join score_transactions transactions
         on transactions.id = audit.entity_id and audit.entity_type = 'score_transaction'
       join score_postings postings on postings.transaction_id = transactions.id
       join event_participants participants on participants.id = postings.participant_id
       left join score_activities activities on activities.id = transactions.activity_id
      where audit.event_slug = $1 and audit.assignment_id = $2
        and transactions.status = 'accepted'
      order by transactions.created_at desc, transactions.id
      limit 12`,
    [eventSlug, assignmentId],
  );
  return rows.map((row) => ({
    id: row.id,
    participantLabel: row.participant_label,
    activityName: row.activity_name ?? "Points award",
    points: row.points,
    createdAt: row.created_at.toISOString(),
    reversible: !row.reversed,
  }));
}

export async function admitStaffTicket(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  scanned: string;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "admitTickets");
  if (!context || !assignment)
    return { ok: false as const, status: 403, error: "This staff link cannot admit tickets" };
  const outcome = await redeemTicket({
    scanned: input.scanned,
    eventSlug: input.eventSlug,
    redeemedBy: assignment.label,
  });
  if (outcome.result === "admitted" && outcome.ticket) {
    const checkInActivity = (await listScoringActivities(input.eventSlug)).find(
      (activity) => activity.template === "check-in" && activity.status === "live",
    );
    await checkInForScoring({
      eventSlug: input.eventSlug,
      ticketId: outcome.ticket.id,
      idempotencyKey: `admission-${outcome.ticket.id}`,
      actorId: assignment.id,
      checkInPoints: checkInActivity?.rule.fixedPoints,
    });
  }
  return { ok: true as const, value: outcome };
}

export async function scanStaffCheckpoint(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  checkpointId: string;
  scanned: string;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = staffAssignmentForPermission(
    context?.access ?? null,
    "scanCheckpoints",
    (entry) => canUseCheckpoint(entry, input.checkpointId),
  );
  if (!context || !assignment)
    return { ok: false as const, status: 403, error: "This role cannot scan that checkpoint" };
  const outcome = await checkpointScan({
    eventSlug: input.eventSlug,
    checkpointId: input.checkpointId,
    scanned: input.scanned,
    consume: 1,
    scannedBy: assignment.label,
  });
  return { ok: true as const, value: outcome };
}

export async function searchStaffParticipants(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  term: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context || !assignmentFor(context, "viewParticipantPoints")) return [];
  const includeEmail =
    assignmentFor(context, "resolveIdentity") !== null ||
    assignmentFor(context, "manageStaffAndPools") !== null;
  return searchEventParticipants(input.eventSlug, input.term, 20, includeEmail);
}

async function listRecentStaffParticipants(
  eventSlug: string,
  assignmentId: string,
  assignmentLabel: string,
  includeEmail: boolean,
) {
  const rows = await query<{
    id: string;
    generated_alias: string;
    chosen_alias: string | null;
    display_name: string | null;
    ticket_id: string | null;
    balance: number;
    checked_in_at: Date | null;
    email: string | null;
    order_size: number;
    order_points: number;
    recent_reason: "scan" | "award";
    happened_at: Date;
  }>(
    `with recent as (
       select participants.id, 'scan'::text as recent_reason, tickets.redeemed_at as happened_at
         from tickets
         join event_participants participants on participants.ticket_id = tickets.id
        where tickets.event_slug = $1 and tickets.redeemed_by = $3 and tickets.redeemed_at is not null
       union all
       select postings.participant_id, 'award'::text, transactions.created_at
         from score_audit_events audit
         join score_transactions transactions
           on transactions.id = audit.entity_id and audit.entity_type = 'score_transaction'
         join score_postings postings on postings.transaction_id = transactions.id
        where audit.event_slug = $1 and audit.assignment_id = $2
     ), ranked as (
       select distinct on (id) id, recent_reason, happened_at
         from recent order by id, happened_at desc
     )
     select participants.id, participants.generated_alias, participants.chosen_alias,
            participants.display_name,
            participants.ticket_id, coalesce(projections.balance, 0)::integer as balance,
            participants.checked_in_at, tickets.email, ranked.recent_reason, ranked.happened_at,
            coalesce(ticket_order.size, 1)::integer as order_size,
            coalesce(ticket_order.points, coalesce(projections.balance, 0))::integer as order_points
       from ranked
       join event_participants participants on participants.id = ranked.id
       left join tickets on tickets.id = participants.ticket_id
       left join score_projections projections on projections.participant_id = participants.id
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
      order by ranked.happened_at desc limit 12`,
    [eventSlug, assignmentId, assignmentLabel],
  );
  return rows.map((row) => ({
    id: row.id,
    publicAlias: row.chosen_alias ?? row.generated_alias,
    displayName: row.display_name ?? undefined,
    ticketSuffix: row.ticket_id?.slice(-8),
    balance: row.balance,
    checkedIn: row.checked_in_at !== null,
    email: includeEmail ? (row.email ?? undefined) : undefined,
    recentReason: row.recent_reason,
    orderSize: row.order_size,
    orderPoints: row.order_points,
  }));
}

export async function resolveStaffScannedParticipant(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  scanned: string;
}) {
  const context = await resolveStaffScoringContext(input);
  if (!context || !assignmentFor(context, "viewParticipantPoints")) return null;
  const participant = await participantFromScannedValue(input.eventSlug, input.scanned);
  if (!participant) return null;
  const order = await ticketOrderSummaryForParticipant(input.eventSlug, participant.id);
  return {
    id: participant.id,
    publicAlias: participant.publicAlias,
    displayName: participant.displayName,
    ticketSuffix: participant.ticketId?.slice(-8),
    balance: participant.balance,
    checkedIn: participant.checkedInAt !== undefined,
    teamName: participant.teamName,
    ...order,
  };
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
  recipientScope?: "participant" | "order";
  commandId: string;
  note?: string;
  confirmLarge?: boolean;
  media?: {
    storageRef: string;
    visibility: "event-album" | "admin-evidence" | "discard";
    consentState: "not-requested" | "requested" | "obtained" | "declined";
  };
}): Promise<ScoringOperationResult<ScoreTransaction>> {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "awardPoints", input.activityId);
  if (!context || !assignment) {
    return { ok: false, status: 403, error: "This activity is outside this staff assignment" };
  }
  const activities = await listScoringActivities(input.eventSlug);
  const activity = activities.find((entry) => entry.id === input.activityId);
  if (!activity) return { ok: false, status: 404, error: "Activity not found" };
  if (input.points !== undefined && !scopeBoolean(assignment, "allowFreeformPoints")) {
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
  const participantIds =
    input.recipientScope === "order"
      ? await participantIdsInTicketOrder(input.eventSlug, participant.id)
      : [participant.id];
  if (participantIds.length === 0) {
    return { ok: false, status: 409, error: "No active tickets in this order can receive points" };
  }
  const points = input.points ?? convertRulePoints(activity.rule, input);
  const maximum = Math.min(
    SCORE_ECONOMY.maximumSingleAward,
    Math.max(
      1,
      Math.trunc(scopeNumber(assignment, "maxPointsPerAward", SCORE_ECONOMY.maximumSingleAward)),
    ),
  );
  if (points > maximum) {
    return {
      ok: false,
      status: 400,
      error: `This role can award at most ${maximum} points per person at once`,
    };
  }
  const warningAt = Math.min(
    maximum,
    Math.max(1, scopeNumber(assignment, "largeAwardWarningAt", 10)),
  );
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
    pools.find((entry) => entry.ownerId === assignment.id);
  if (!pool && !scopeBoolean(assignment, "unmetered")) {
    return { ok: false, status: 409, error: "This staff assignment has no points pool" };
  }
  const awarded = await awardPoints({
    eventSlug: input.eventSlug,
    activityId: activity.id,
    participantIds,
    rawScore: input.rawScore,
    placement: input.placement,
    points: input.points,
    sourceId: `staff_${input.commandId}`,
    idempotencyKey: input.commandId,
    actorType: "staff",
    actorId: assignment.assignmentType === "personal" ? assignment.id : undefined,
    assignmentId: assignment.id,
    stationId: assignment.assignmentType === "station" ? assignment.id : undefined,
    deviceId: context.deviceId,
    note: input.note,
    poolId: pool?.id,
    allowOverride: input.points !== undefined,
  });
  if (!awarded.ok || !input.media) return awarded;
  const mediaAssignment = assignmentFor(context, "uploadActivityPhotos", input.activityId);
  if (!mediaAssignment) {
    return awarded;
  }
  const settings = await getScoring(input.eventSlug);
  if (settings.photoConsentPolicy === "required" && input.media.consentState !== "obtained") {
    return awarded;
  }
  const drop = await getEventDrop(input.eventSlug);
  try {
    await createScoreMediaLink({
      eventSlug: input.eventSlug,
      activityId: activity.id,
      transactionId: awarded.value.id,
      participantId: participant.id,
      staffActorId: mediaAssignment.id,
      storageRef: input.media.storageRef,
      visibility: input.media.visibility,
      consentState: input.media.consentState,
      expiresAt: drop?.expiresAt,
    });
  } catch {
    await recordScoringOperationalEvent({
      eventSlug: input.eventSlug,
      kind: "media-failure",
      operation: "staff-award-attachment",
    }).catch(() => undefined);
  }
  return awarded;
}

export async function mintStaffAwardClaim(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  activityId: string;
  points?: number;
  note?: string;
  expiresInSeconds?: number;
}) {
  const context = await resolveStaffScoringContext(input);
  const assignment = assignmentFor(context, "awardPoints", input.activityId);
  if (!context || !assignment) {
    return {
      ok: false as const,
      status: 403,
      error: "This activity is outside this staff assignment",
    };
  }
  if (input.points !== undefined && !scopeBoolean(assignment, "allowFreeformPoints")) {
    return {
      ok: false as const,
      status: 403,
      error: "This staff link cannot create custom awards",
    };
  }
  const maximum = Math.min(
    SCORE_ECONOMY.maximumSingleAward,
    Math.max(
      1,
      Math.trunc(scopeNumber(assignment, "maxPointsPerAward", SCORE_ECONOMY.maximumSingleAward)),
    ),
  );
  if (input.points !== undefined && input.points > maximum) {
    return {
      ok: false as const,
      status: 400,
      error: `This role can put at most ${maximum} points on one QR`,
    };
  }
  const activity = (await listScoringActivities(input.eventSlug)).find(
    (entry) => entry.id === input.activityId && entry.status === "live",
  );
  if (!activity) return { ok: false as const, status: 404, error: "Activity not found" };
  const pools = await listPools(input.eventSlug);
  const pool =
    pools.find((entry) => entry.activityId === activity.id) ??
    pools.find((entry) => entry.ownerId === assignment.id);
  if (!pool && !scopeBoolean(assignment, "unmetered")) {
    return { ok: false as const, status: 409, error: "This staff assignment has no points pool" };
  }
  return createStaffAwardClaim({
    eventSlug: input.eventSlug,
    assignment,
    activity,
    poolId: pool?.id,
    deviceId: input.deviceId,
    pointsOverride: input.points,
    note: input.note,
    expiresInSeconds: input.expiresInSeconds ?? 60,
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
  const assignment = assignmentFor(context, "reverseAwards");
  if (!context || !assignment) {
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
    [input.eventSlug, input.transactionId, assignment.id],
  );
  if (!ownAudit) return { ok: false, status: 403, error: "Staff can reverse only their own award" };
  if (Date.now() - Date.parse(transaction.createdAt) > 15 * 60 * 1_000) {
    return { ok: false, status: 409, error: "The quick undo window has ended; ask a manager" };
  }
  return reversePoints({
    eventSlug: input.eventSlug,
    transactionId: input.transactionId,
    idempotencyKey: input.commandId ?? `staff-reverse-${randomUUID()}`,
    actorType: "staff",
    actorId: assignment.id,
    note: input.note,
  });
}
