import { createHash, randomUUID } from "node:crypto";

import { isValidTicketId, parseTicketQrPayload } from "@/features/tickets/types";
import { verifyTicketSignature } from "@/features/tickets/qr.server";
import { transaction } from "@/lib/platform/postgres.server";
import { getActivity, participantForTicket, recordScoreInTransaction } from "./store.server";
import { hasStaffPermission, resolveStaffAccess } from "./staff.server";
import { convertRulePoints } from "./types";

export type OfflineScoreCommand = {
  commandId: string;
  localSequence: number;
  participantProof: string;
  result: { placement?: number; rawScore?: number };
  deviceTime: string;
};

function id(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function proofHash(proof: string) {
  return createHash("sha256").update(proof).digest("hex");
}

async function participantFromProof(eventSlug: string, proof: string) {
  const parsed = parseTicketQrPayload(proof);
  const typed = proof.trim().toUpperCase();
  const ticketId = parsed?.ticketId ?? (isValidTicketId(typed) ? typed : null);
  if (!ticketId || (parsed && !verifyTicketSignature(parsed.ticketId, parsed.signature)))
    return null;
  const participant = await participantForTicket(ticketId);
  return participant?.eventSlug === eventSlug ? participant : null;
}

export async function reserveOfflineScoreBudget(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  activityId: string;
  points: number;
  expiresInMinutes?: number;
}) {
  if (!Number.isInteger(input.points) || input.points < 1)
    return { ok: false as const, status: 400, error: "Choose a positive whole-point budget" };
  const assignment = await resolveStaffAccess(input);
  if (!assignment || !hasStaffPermission(assignment, "awardPoints"))
    return { ok: false as const, status: 403, error: "This staff link cannot score offline" };
  if (assignment.scope.unmetered === true)
    return { ok: false as const, status: 409, error: "Unmetered scoring is online only" };
  const activityIds = assignment.scope.activityIds;
  if (Array.isArray(activityIds) && !activityIds.includes(input.activityId))
    return { ok: false as const, status: 403, error: "This activity is outside the assignment" };
  const maximum =
    typeof assignment.scope.offlineBudgetMax === "number"
      ? Math.max(1, Math.trunc(assignment.scope.offlineBudgetMax))
      : 50;
  if (input.points > maximum)
    return { ok: false as const, status: 409, error: `Offline budget cannot exceed ${maximum}` };
  const minutes = Math.min(240, Math.max(5, Math.trunc(input.expiresInMinutes ?? 60)));
  return transaction(async (client) => {
    const pool = await client.query<{ id: string }>(
      `select id from score_pools
        where event_slug = $1
          and (activity_id = $2 or owner_id = $3)
          and issued_points - reserved_points - spent_points - held_points >= $4
        order by case when activity_id = $2 then 0 else 1 end
        limit 1 for update`,
      [input.eventSlug, input.activityId, assignment.id, input.points],
    );
    if (!pool.rows[0])
      return {
        ok: false as const,
        status: 409,
        error: "The confirmed pool cannot fund that offline budget",
      };
    const existing = await client.query<{ id: string }>(
      `select id from score_offline_reservations
        where assignment_id = $1 and device_id = $2 and activity_id = $3 and status = 'active'
        for update`,
      [assignment.id, input.deviceId, input.activityId],
    );
    if (existing.rows[0])
      return {
        ok: false as const,
        status: 409,
        error: "This device already has an active offline budget",
      };
    const reservationId = id("offline");
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    await client.query(
      `update score_pools set reserved_points = reserved_points + $2, updated_at = now() where id = $1`,
      [pool.rows[0].id, input.points],
    );
    await client.query(
      `insert into score_offline_reservations
         (id,event_slug,assignment_id,device_id,activity_id,pool_id,issued_points,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        reservationId,
        input.eventSlug,
        assignment.id,
        input.deviceId,
        input.activityId,
        pool.rows[0].id,
        input.points,
        expiresAt,
      ],
    );
    return {
      ok: true as const,
      value: {
        id: reservationId,
        activityId: input.activityId,
        points: input.points,
        spent: 0,
        expiresAt: expiresAt.toISOString(),
      },
    };
  });
}

export async function reconcileOfflineScoreCommands(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  reservationId: string;
  commands: OfflineScoreCommand[];
}) {
  const assignment = await resolveStaffAccess(input);
  if (!assignment || !hasStaffPermission(assignment, "awardPoints"))
    return { ok: false as const, status: 403, error: "This staff link cannot reconcile scoring" };
  if (input.commands.length > 100)
    return { ok: false as const, status: 400, error: "Reconcile at most 100 commands at once" };
  const outcomes = [] as Array<{
    commandId: string;
    state: "accepted" | "held" | "rejected";
    reason?: string;
  }>;
  for (const command of [...input.commands].sort((a, b) => a.localSequence - b.localSequence)) {
    const outcome = await transaction(async (client) => {
      const existing = await client.query<{
        state: "accepted" | "held" | "rejected";
        reason: string | null;
      }>(`select state, reason from score_offline_commands where command_id = $1`, [
        command.commandId,
      ]);
      if (existing.rows[0])
        return {
          commandId: command.commandId,
          state: existing.rows[0].state,
          reason: existing.rows[0].reason ?? undefined,
        };
      const reservation = await client.query<{
        activity_id: string;
        pool_id: string;
        issued_points: number;
        spent_points: number;
        expires_at: Date;
        status: string;
      }>(
        `select activity_id,pool_id,issued_points,spent_points,expires_at,status
           from score_offline_reservations
          where id = $1 and event_slug = $2 and assignment_id = $3 and device_id = $4 for update`,
        [input.reservationId, input.eventSlug, assignment.id, input.deviceId],
      );
      const held = async (state: "held" | "rejected", reason: string) => {
        await client.query(
          `insert into score_offline_commands
             (command_id,reservation_id,local_sequence,participant_proof_hash,result,device_time,state,reason)
           values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
          [
            command.commandId,
            input.reservationId,
            command.localSequence,
            proofHash(command.participantProof),
            JSON.stringify(command.result),
            command.deviceTime,
            state,
            reason,
          ],
        );
        return { commandId: command.commandId, state, reason };
      };
      const row = reservation.rows[0];
      if (!row)
        return {
          commandId: command.commandId,
          state: "held" as const,
          reason: "Offline reservation was not found",
        };
      const sequence = await client.query<{ command_id: string }>(
        `select command_id from score_offline_commands
          where reservation_id = $1 and local_sequence = $2`,
        [input.reservationId, command.localSequence],
      );
      if (sequence.rows[0])
        return {
          commandId: command.commandId,
          state: "held" as const,
          reason: "This local sequence belongs to another command",
        };
      if (row.status !== "active") return held("held", "Offline reservation is not active");
      if (!Number.isFinite(Date.parse(command.deviceTime)))
        return held("rejected", "Device time is invalid");
      if (row.expires_at.getTime() < Date.parse(command.deviceTime))
        return held("rejected", "Offline reservation had expired");
      const [participant, activity] = await Promise.all([
        participantFromProof(input.eventSlug, command.participantProof),
        getActivity(row.activity_id),
      ]);
      if (!participant || !activity) return held("held", "Participant or activity needs review");
      const points = convertRulePoints(activity.rule, command.result);
      if (points < 1 || row.spent_points + points > row.issued_points)
        return held("rejected", "Offline reservation does not have enough points");
      await client.query(
        `update score_pools set reserved_points = reserved_points - $2, updated_at = now()
          where id = $1 and reserved_points >= $2`,
        [row.pool_id, points],
      );
      const scored = await recordScoreInTransaction(client, {
        eventSlug: input.eventSlug,
        activityId: row.activity_id,
        sourceType: "manual",
        sourceId: `offline_${command.commandId}`,
        idempotencyKey: command.commandId,
        reasonCode: activity.template as Parameters<
          typeof recordScoreInTransaction
        >[1]["reasonCode"],
        ruleRevision: activity.ruleRevision,
        actorType: "staff",
        actorId: assignment.assignmentType === "personal" ? assignment.id : undefined,
        assignmentId: assignment.id,
        stationId: assignment.assignmentType === "station" ? assignment.id : undefined,
        deviceId: input.deviceId,
        postings: [{ participantId: participant.id, points }],
        poolId: row.pool_id,
        metadata: {
          origin: "offline",
          localSequence: command.localSequence,
          deviceTime: command.deviceTime,
        },
      });
      if (!scored.ok) {
        await client.query(
          `update score_pools set reserved_points = reserved_points + $2 where id = $1`,
          [row.pool_id, points],
        );
        return held(scored.status >= 500 ? "held" : "rejected", scored.error);
      }
      await client.query(
        `update score_offline_reservations set spent_points = spent_points + $2 where id = $1`,
        [input.reservationId, points],
      );
      await client.query(
        `insert into score_offline_commands
           (command_id,reservation_id,local_sequence,participant_proof_hash,result,device_time,state,transaction_id)
         values ($1,$2,$3,$4,$5::jsonb,$6,'accepted',$7)`,
        [
          command.commandId,
          input.reservationId,
          command.localSequence,
          proofHash(command.participantProof),
          JSON.stringify(command.result),
          command.deviceTime,
          scored.value.id,
        ],
      );
      return { commandId: command.commandId, state: "accepted" as const };
    });
    outcomes.push(outcome);
  }
  return { ok: true as const, value: outcomes };
}

export async function closeOfflineScoreReservation(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
  reservationId: string;
}) {
  const assignment = await resolveStaffAccess(input);
  if (!assignment) return { ok: false as const, status: 403, error: "Staff access is invalid" };
  return transaction(async (client) => {
    const reservation = await client.query<{
      pool_id: string;
      issued_points: number;
      spent_points: number;
    }>(
      `update score_offline_reservations set status = 'closed', closed_at = now()
        where id = $1 and event_slug = $2 and assignment_id = $3 and device_id = $4 and status = 'active'
        returning pool_id,issued_points,spent_points`,
      [input.reservationId, input.eventSlug, assignment.id, input.deviceId],
    );
    const row = reservation.rows[0];
    if (!row) return { ok: false as const, status: 404, error: "Active reservation not found" };
    const unused = row.issued_points - row.spent_points;
    await client.query(
      `update score_pools set reserved_points = reserved_points - $2, updated_at = now() where id = $1`,
      [row.pool_id, unused],
    );
    return { ok: true as const, value: { releasedPoints: unused } };
  });
}
