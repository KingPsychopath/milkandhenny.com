import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  createDiscovery,
  listDiscoveries,
  replaceDiscoveryClueSecret,
  replaceDiscoverySecret,
} from "@/features/event-scoring/discoveries.server";
import {
  acceptHeldScore,
  createPool,
  createTeam,
  listHeldScoreTransactions,
  listPools,
  listTeams,
  rebuildEventProjections,
  setTeamMembership,
} from "@/features/event-scoring/store.server";
import {
  awardPoints,
  changeScoringState,
  configureScoring,
  createScoringActivity,
  finalizeLeaderboard,
  getScoring,
  listScoringActivities,
  reversePoints,
  transferPoints,
  updateScoringActivity,
} from "@/features/event-scoring/scoring.server";
import { createStaffAccess, type StaffPreset } from "@/features/event-scoring/staff.server";
import { buildDiscoveryPrintPack } from "@/features/event-scoring/print.server";
import { printLayout } from "@/features/event-scoring/print";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  isLeaderboardVisibility,
  isScoringState,
  type ScoreRule,
} from "@/features/event-scoring/types";

function recordBody(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function handleGET(request: Request, slug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const [settings, activities, pools, discoveries, teams, held] = await Promise.all([
      getScoring(slug),
      listScoringActivities(slug),
      listPools(slug),
      listDiscoveries(slug),
      listTeams(slug),
      listHeldScoreTransactions(slug),
    ]);
    return Response.json({ settings, activities, pools, discoveries, teams, held });
  } catch (error) {
    return apiErrorFromRequest(request, "event-scoring.admin.get", "Could not load scoring", error);
  }
}

async function handlePOST(request: Request, slug: string) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;
  try {
    const body = recordBody(await request.json().catch(() => null));
    if (!body) return Response.json({ error: "Invalid request body" }, { status: 400 });
    const action = stringValue(body.action);
    const actorId = auth.payload?.jti ?? "admin-local";

    if (action === "state") {
      const state = body.state;
      if (!isScoringState(state))
        return Response.json({ error: "Unknown scoring state" }, { status: 400 });
      const result = await changeScoringState({
        eventSlug: slug,
        state,
        actorId,
        reason: stringValue(body.reason),
        force: body.force === true,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ settings: result.value });
    }

    if (action === "settings") {
      const visibility = body.leaderboardVisibility;
      if (visibility !== undefined && !isLeaderboardVisibility(visibility))
        return Response.json({ error: "Unknown leaderboard visibility" }, { status: 400 });
      const result = await configureScoring({
        eventSlug: slug,
        actorId,
        leaderboardVisibility: visibility,
        scheduledStart: stringValue(body.scheduledStart),
        scheduledEnd: stringValue(body.scheduledEnd),
        allowPreCheckinOnlinePoints:
          typeof body.allowPreCheckinOnlinePoints === "boolean"
            ? body.allowPreCheckinOnlinePoints
            : undefined,
        publicNames:
          body.publicNames === "generated" ||
          body.publicNames === "choice" ||
          body.publicNames === "canonical"
            ? body.publicNames
            : undefined,
        publicRankingPolicy:
          body.publicRankingPolicy === "include" ||
          body.publicRankingPolicy === "exclude-refunded" ||
          body.publicRankingPolicy === "exclude-disqualified"
            ? body.publicRankingPolicy
            : undefined,
        photoConsentPolicy:
          body.photoConsentPolicy === "ask" ||
          body.photoConsentPolicy === "required" ||
          body.photoConsentPolicy === "not-required"
            ? body.photoConsentPolicy
            : undefined,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ settings: result.value });
    }

    if (action === "create-activity") {
      const name = stringValue(body.name);
      const template = stringValue(body.template);
      if (
        !name ||
        !template ||
        !body.rule ||
        typeof body.rule !== "object" ||
        Array.isArray(body.rule)
      )
        return Response.json(
          { error: "Activity name, template, and rule are required" },
          { status: 400 },
        );
      const result = await createScoringActivity({
        eventSlug: slug,
        actorId,
        name,
        template: template as Parameters<typeof createScoringActivity>[0]["template"],
        rule: body.rule as ScoreRule,
        status: stringValue(body.status) as Parameters<typeof createScoringActivity>[0]["status"],
        startsAt: stringValue(body.startsAt),
        endsAt: stringValue(body.endsAt),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ activity: result.value }, { status: 201 });
    }

    if (action === "update-activity") {
      const activityId = stringValue(body.activityId);
      if (!activityId) return Response.json({ error: "Activity is required" }, { status: 400 });
      const result = await updateScoringActivity({
        activityId,
        actorId,
        name: stringValue(body.name),
        status: stringValue(body.status) as Parameters<typeof updateScoringActivity>[0]["status"],
        startsAt: stringValue(body.startsAt),
        endsAt: stringValue(body.endsAt),
        rule:
          body.rule && typeof body.rule === "object" && !Array.isArray(body.rule)
            ? (body.rule as ScoreRule)
            : undefined,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ activity: result.value });
    }

    if (action === "award") {
      const activityId = stringValue(body.activityId);
      const participantIds = Array.isArray(body.participantIds)
        ? body.participantIds.filter((value): value is string => typeof value === "string")
        : [];
      const idempotencyKey = stringValue(body.idempotencyKey);
      if (!activityId || !idempotencyKey)
        return Response.json({ error: "Activity and command id are required" }, { status: 400 });
      const result = await awardPoints({
        eventSlug: slug,
        activityId,
        participantIds,
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
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ transaction: result.value });
    }

    if (action === "reverse") {
      const transactionId = stringValue(body.transactionId);
      const idempotencyKey = stringValue(body.idempotencyKey);
      const note = stringValue(body.note);
      if (!transactionId || !idempotencyKey || !note)
        return Response.json(
          { error: "Transaction, command id, and note are required" },
          { status: 400 },
        );
      const result = await reversePoints({
        eventSlug: slug,
        transactionId,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ transaction: result.value });
    }

    if (action === "transfer") {
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
      const result = await transferPoints({
        eventSlug: slug,
        fromParticipantId,
        toParticipantId,
        points: body.points,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ transaction: result.value });
    }

    if (action === "create-discovery") {
      const activityId = stringValue(body.activityId);
      const name = stringValue(body.name);
      const method = stringValue(body.method);
      if (
        !activityId ||
        !name ||
        !method ||
        !body.rule ||
        typeof body.rule !== "object" ||
        Array.isArray(body.rule)
      )
        return Response.json(
          { error: "Discovery name, activity, method, and rule are required" },
          { status: 400 },
        );
      const result = await createDiscovery({
        eventSlug: slug,
        activityId,
        name,
        method: method as Parameters<typeof createDiscovery>[0]["method"],
        rule: body.rule as Parameters<typeof createDiscovery>[0]["rule"],
        clues: Array.isArray(body.clues)
          ? body.clues.flatMap((clue) => {
              if (!clue || typeof clue !== "object" || Array.isArray(clue)) return [];
              const record = clue as Record<string, unknown>;
              const key = stringValue(record.key);
              const label = stringValue(record.label);
              return key && label ? [{ key, label }] : [];
            })
          : undefined,
        includeSecret: true,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ discovery: result.value }, { status: 201 });
    }

    if (action === "replace-discovery-secret") {
      const discoveryId = stringValue(body.discoveryId);
      if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
      const result = await replaceDiscoverySecret({ eventSlug: slug, discoveryId, actorId });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result.value, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "replace-discovery-clue") {
      const discoveryId = stringValue(body.discoveryId);
      const clueKey = stringValue(body.clueKey);
      if (!discoveryId || !clueKey)
        return Response.json({ error: "Discovery and clue are required" }, { status: 400 });
      const result = await replaceDiscoveryClueSecret({
        eventSlug: slug,
        discoveryId,
        clueKey,
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result.value, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "rebuild-projections") {
      const result = await rebuildEventProjections(slug);
      return Response.json({ projection: result });
    }

    if (action === "accept-held") {
      const transactionId = stringValue(body.transactionId);
      if (!transactionId)
        return Response.json({ error: "Held transaction is required" }, { status: 400 });
      const result = await acceptHeldScore(slug, transactionId, { actorType: "admin", actorId });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ transaction: result.value });
    }

    if (action === "finalize") {
      if (typeof body.prizeSlots !== "number")
        return Response.json({ error: "Prize slots are required" }, { status: 400 });
      const result = await finalizeLeaderboard({
        eventSlug: slug,
        actorId,
        prizeSlots: body.prizeSlots,
        resolvedTies: body.resolvedTies === true,
        reason: stringValue(body.reason),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ finalization: result.value });
    }

    if (action === "create-team") {
      const name = stringValue(body.name);
      if (!name) return Response.json({ error: "Team name is required" }, { status: 400 });
      const result = await createTeam({ eventSlug: slug, name });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ team: result.value }, { status: 201 });
    }

    if (action === "assign-team") {
      const teamId = stringValue(body.teamId);
      const participantId = stringValue(body.participantId);
      if (!teamId || !participantId)
        return Response.json({ error: "Team and participant are required" }, { status: 400 });
      const result = await setTeamMembership({
        eventSlug: slug,
        teamId,
        participantId,
        startsAt: stringValue(body.startsAt),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ membership: result.value }, { status: 201 });
    }

    if (action === "issue-pool") {
      const points = body.points;
      const ownerType = body.ownerType;
      if (
        typeof points !== "number" ||
        (ownerType !== "event" &&
          ownerType !== "staff" &&
          ownerType !== "station" &&
          ownerType !== "activity")
      ) {
        return Response.json(
          { error: "Pool owner and whole points are required" },
          { status: 400 },
        );
      }
      const result = await createPool({
        eventSlug: slug,
        points,
        ownerType,
        ownerId: stringValue(body.ownerId),
        activityId: stringValue(body.activityId),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ pool: result.value }, { status: 201 });
    }

    if (action === "create-staff") {
      const label = stringValue(body.label);
      const preset = stringValue(body.preset);
      const assignmentType =
        body.assignmentType === "station"
          ? "station"
          : body.assignmentType === "personal"
            ? "personal"
            : null;
      if (
        !label ||
        !preset ||
        !assignmentType ||
        !(
          preset in
          {
            "door-scanner": true,
            "door-manager": true,
            "game-moderator": true,
            "points-marshal": true,
            "activity-manager": true,
            "event-manager": true,
            admin: true,
          }
        )
      ) {
        return Response.json(
          { error: "Staff label, preset, and assignment type are required" },
          { status: 400 },
        );
      }
      const result = await createStaffAccess({
        eventSlug: slug,
        label,
        assignmentType,
        preset: preset as StaffPreset,
        scope:
          body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
            ? (body.scope as Record<string, unknown>)
            : undefined,
        expiresAt: stringValue(body.expiresAt),
      });
      return Response.json({ assignment: result }, { status: 201 });
    }

    if (action === "print-pack") {
      const layout = stringValue(body.layout);
      if (!layout || !printLayout(layout))
        return Response.json({ error: "A valid print layout is required" }, { status: 400 });
      const discoveryIds = Array.isArray(body.discoveryIds)
        ? body.discoveryIds.filter((value): value is string => typeof value === "string")
        : undefined;
      const result = await buildDiscoveryPrintPack({
        eventSlug: slug,
        layout,
        paper:
          body.paper === "letter" || body.paper === "a5" || body.paper === "card"
            ? body.paper
            : "a4",
        includePoints: body.includePoints !== false,
        includePlacementNotes: body.includePlacementNotes === true,
        discoveryIds,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ error: "Unknown scoring action" }, { status: 400 });
  } catch (error) {
    return apiErrorFromRequest(request, "event-scoring.admin.post", "Scoring action failed", error);
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/scoring")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
    },
  },
});
