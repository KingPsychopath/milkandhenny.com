import { confirmManagedEventGameResult } from "../game-launch.server";
import {
  listHeldOfficialGameResults,
  retryHeldOfficialGameResult,
  retryHeldOfficialGameResultsForEvent,
} from "../games.server";
import {
  applyPenalty,
  awardPoints,
  correctPointsAfterClose,
  reversePoints,
  transferPoints,
} from "../scoring.server";
import { acceptHeldScore, rebuildEventProjections } from "../store.server";
import {
  recordBody,
  resultResponse,
  stringsValue,
  stringValue,
  type AdminScoringActionHandlers,
} from "./shared";

export const ledgerActions: AdminScoringActionHandlers = {
  award: async ({ eventSlug, actorId, body }) => {
    const activityId = stringValue(body.activityId);
    const idempotencyKey = stringValue(body.idempotencyKey);
    if (!activityId || !idempotencyKey)
      return Response.json({ error: "Activity and command id are required" }, { status: 400 });
    return resultResponse(
      await awardPoints({
        eventSlug,
        activityId,
        participantIds: stringsValue(body.participantIds),
        rawScore: typeof body.rawScore === "number" ? body.rawScore : undefined,
        placement: typeof body.placement === "number" ? body.placement : undefined,
        points: typeof body.points === "number" ? body.points : undefined,
        sourceId: stringValue(body.sourceId),
        idempotencyKey,
        actorType: "admin",
        actorId,
        note: stringValue(body.note),
        poolId: stringValue(body.poolId),
        allowOverride: body.allowOverride === true,
      }),
      "transaction",
    );
  },

  "confirm-managed-game-result": async ({ eventSlug, body }) => {
    const kind = body.kind;
    const activityId = stringValue(body.activityId);
    const gameInstanceId = stringValue(body.gameInstanceId);
    const resultId = stringValue(body.resultId);
    if (
      (kind !== "pitches" && kind !== "icebreaker") ||
      !activityId ||
      !gameInstanceId ||
      !resultId
    )
      return Response.json({ error: "Managed game result is incomplete" }, { status: 400 });

    const result = await confirmManagedEventGameResult(
      kind === "pitches"
        ? {
            kind,
            eventSlug,
            activityId,
            gameInstanceId,
            resultId,
            candidateParticipantIds: stringsValue(body.candidateParticipantIds),
            ballots: Array.isArray(body.ballots)
              ? body.ballots.flatMap((value) => {
                  const ballot = recordBody(value);
                  const voterParticipantId = ballot && stringValue(ballot.voterParticipantId);
                  const candidateParticipantId =
                    ballot && stringValue(ballot.candidateParticipantId);
                  return voterParticipantId && candidateParticipantId
                    ? [{ voterParticipantId, candidateParticipantId }]
                    : [];
                })
              : [],
          }
        : {
            kind,
            eventSlug,
            activityId,
            gameInstanceId,
            resultId,
            participantIds: stringsValue(body.participantIds),
          },
    );
    return resultResponse(result, "transaction");
  },

  reverse: async ({ eventSlug, actorId, body }) => {
    const transactionId = stringValue(body.transactionId);
    const idempotencyKey = stringValue(body.idempotencyKey);
    const note = stringValue(body.note);
    if (!transactionId || !idempotencyKey || !note)
      return Response.json(
        { error: "Transaction, command id, and note are required" },
        { status: 400 },
      );
    return resultResponse(
      await reversePoints({
        eventSlug,
        transactionId,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      }),
      "transaction",
    );
  },

  penalty: async ({ eventSlug, actorId, body }) => {
    const activityId = stringValue(body.activityId);
    const participantId = stringValue(body.participantId);
    const idempotencyKey = stringValue(body.idempotencyKey);
    const note = stringValue(body.note);
    if (
      !activityId ||
      !participantId ||
      !idempotencyKey ||
      !note ||
      typeof body.points !== "number"
    )
      return Response.json(
        { error: "Penalty activity, participant, points, command id, and note are required" },
        { status: 400 },
      );
    return resultResponse(
      await applyPenalty({
        eventSlug,
        activityId,
        participantId,
        points: body.points,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      }),
      "transaction",
    );
  },

  "closed-correction": async ({ eventSlug, actorId, body }) => {
    const activityId = stringValue(body.activityId);
    const participantId = stringValue(body.participantId);
    const idempotencyKey = stringValue(body.idempotencyKey);
    const note = stringValue(body.note);
    if (!activityId || !participantId || !idempotencyKey || !note || typeof body.delta !== "number")
      return Response.json(
        { error: "Correction activity, participant, amount, command id, and reason are required" },
        { status: 400 },
      );
    const result = await correctPointsAfterClose({
      eventSlug,
      activityId,
      participantId,
      delta: body.delta,
      idempotencyKey,
      note,
      actorId,
      confirmed: body.confirmed === true,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ transaction: result.value, leaderboard: "provisional" });
  },

  transfer: async ({ eventSlug, actorId, body }) => {
    const fromParticipantId = stringValue(body.fromParticipantId);
    const toParticipantId = stringValue(body.toParticipantId);
    const idempotencyKey = stringValue(body.idempotencyKey);
    const note = stringValue(body.note);
    if (
      !fromParticipantId ||
      !toParticipantId ||
      !idempotencyKey ||
      !note ||
      typeof body.points !== "number"
    )
      return Response.json(
        { error: "Transfer participants, points, command id, and note are required" },
        { status: 400 },
      );
    return resultResponse(
      await transferPoints({
        eventSlug,
        fromParticipantId,
        toParticipantId,
        points: body.points,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      }),
      "transaction",
    );
  },

  "rebuild-projections": async ({ eventSlug }) =>
    Response.json({ projection: await rebuildEventProjections(eventSlug) }),

  "accept-held": async ({ eventSlug, actorId, body }) => {
    const transactionId = stringValue(body.transactionId);
    if (!transactionId)
      return Response.json({ error: "Held transaction is required" }, { status: 400 });
    return resultResponse(
      await acceptHeldScore(eventSlug, transactionId, { actorType: "admin", actorId }),
      "transaction",
    );
  },

  "retry-official-results": async ({ eventSlug, body }) => {
    const resultId = stringValue(body.resultId);
    if (!resultId)
      return Response.json({ retry: await retryHeldOfficialGameResultsForEvent(eventSlug) });
    const held = await listHeldOfficialGameResults(eventSlug);
    if (!held.some((result) => result.id === resultId))
      return Response.json(
        { error: "Held official result not found for this event" },
        { status: 404 },
      );
    return Response.json({ retry: await retryHeldOfficialGameResult(resultId) });
  },
};
