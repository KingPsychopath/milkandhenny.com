import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  copyDiscovery,
  createDiscovery,
  listDiscoveries,
  listDiscoveryClues,
  replaceDiscoveryClueSecret,
  replaceDiscoverySecret,
  testDiscoveryCredential,
  updateDiscovery,
} from "@/features/event-scoring/discoveries.server";
import {
  acceptHeldScore,
  createScoreMediaLink,
  createTeam,
  listHeldScoreTransactions,
  listPools,
  listScoreMediaLinks,
  listScoreAuditEvents,
  listLeaderboardParticipants,
  listParticipantMerges,
  listStaffAssignments,
  listStaffDevices,
  listTeams,
  rebuildEventProjections,
  searchEventParticipants,
  setTeamMembership,
  deleteScoreMediaLink,
  updateScoreMediaConsent,
} from "@/features/event-scoring/store.server";
import { getEventDrop } from "@/features/events/drop.server";
import {
  awardPoints,
  applyPenalty,
  changeScoringState,
  configureScoring,
  copyScoringActivity,
  correctPointsAfterClose,
  createScoringActivity,
  finalizeLeaderboard,
  getScoring,
  listScoringActivities,
  reversePoints,
  mergeParticipants,
  reverseParticipantMerge,
  transferPoints,
  updateScoringActivity,
} from "@/features/event-scoring/scoring.server";
import {
  adjustStaffPool,
  createStaffAccess,
  issueStaffPool,
  revokeStaffAccess,
  revokeStaffAccessDevice,
  type StaffPreset,
} from "@/features/event-scoring/staff.server";
import {
  buildDiscoveryPrintPack,
  renderDiscoveryPrintPdf,
} from "@/features/event-scoring/print.server";
import { printLayout } from "@/features/event-scoring/print";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  isLeaderboardVisibility,
  isScoringState,
  type ScoreRule,
  STAFF_PERMISSIONS,
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
    const search = new URL(request.url).searchParams.get("participant");
    if (search) {
      return Response.json({ participants: await searchEventParticipants(slug, search) });
    }
    const [
      settings,
      activities,
      pools,
      discoveries,
      teams,
      held,
      staff,
      media,
      drop,
      audit,
      merges,
    ] = await Promise.all([
      getScoring(slug),
      listScoringActivities(slug),
      listPools(slug),
      listDiscoveries(slug),
      listTeams(slug),
      listHeldScoreTransactions(slug),
      listStaffAssignments(slug),
      listScoreMediaLinks(slug),
      getEventDrop(slug),
      listScoreAuditEvents({ eventSlug: slug, limit: 100 }),
      listParticipantMerges(slug),
    ]);
    return Response.json({
      settings,
      activities,
      pools,
      discoveries: await Promise.all(
        discoveries.map(async (discovery) => ({
          ...discovery,
          clues:
            discovery.method === "collected-clues" ? await listDiscoveryClues(discovery.id) : [],
        })),
      ),
      teams,
      held,
      staff: await Promise.all(
        staff.map(async (assignment) => ({
          ...assignment,
          devices: await listStaffDevices(assignment.id),
        })),
      ),
      media,
      mediaDrop: drop
        ? {
            uploadPath: drop.live ? `/drop/${drop.token}` : undefined,
            albumPath: `/t/${drop.transferId}`,
            expiresAt: drop.expiresAt,
          }
        : null,
      audit,
      merges,
    });
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

    if (action === "copy-activity") {
      const activityId = stringValue(body.activityId);
      if (!activityId) return Response.json({ error: "Activity is required" }, { status: 400 });
      const result = await copyScoringActivity({
        activityId,
        targetEventSlug: stringValue(body.targetEventSlug) ?? slug,
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ activity: result.value }, { status: 201 });
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

    if (action === "penalty") {
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
      ) {
        return Response.json(
          { error: "Penalty activity, participant, points, command id, and note are required" },
          { status: 400 },
        );
      }
      const result = await applyPenalty({
        eventSlug: slug,
        activityId,
        participantId,
        points: body.points,
        idempotencyKey,
        note,
        actorType: "admin",
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ transaction: result.value });
    }

    if (action === "closed-correction") {
      const activityId = stringValue(body.activityId);
      const participantId = stringValue(body.participantId);
      const idempotencyKey = stringValue(body.idempotencyKey);
      const note = stringValue(body.note);
      if (
        !activityId ||
        !participantId ||
        !idempotencyKey ||
        !note ||
        typeof body.delta !== "number"
      ) {
        return Response.json(
          {
            error: "Correction activity, participant, amount, command id, and reason are required",
          },
          { status: 400 },
        );
      }
      const result = await correctPointsAfterClose({
        eventSlug: slug,
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

    if (action === "update-discovery") {
      const discoveryId = stringValue(body.discoveryId);
      if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
      const result = await updateDiscovery({
        eventSlug: slug,
        discoveryId,
        actorId,
        name: stringValue(body.name),
        status: stringValue(body.status),
        rule:
          body.rule && typeof body.rule === "object" && !Array.isArray(body.rule)
            ? (body.rule as Parameters<typeof updateDiscovery>[0]["rule"])
            : undefined,
        reopen: body.reopen === true,
        reason: stringValue(body.reason),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ discovery: result.value });
    }

    if (action === "copy-discovery") {
      const discoveryId = stringValue(body.discoveryId);
      if (!discoveryId) return Response.json({ error: "Discovery is required" }, { status: 400 });
      const result = await copyDiscovery({
        eventSlug: slug,
        discoveryId,
        actorId,
        name: stringValue(body.name),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ discovery: result.value }, { status: 201 });
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

    if (action === "test-discovery") {
      const discoveryId = stringValue(body.discoveryId);
      const presented = stringValue(body.presented);
      if (!discoveryId || !presented)
        return Response.json({ error: "Discovery and credential are required" }, { status: 400 });
      const result = await testDiscoveryCredential({ discoveryId, presented });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ test: result.value });
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
      const result = await issueStaffPool({
        eventSlug: slug,
        points,
        ownerType,
        ownerId: stringValue(body.ownerId),
        activityId: stringValue(body.activityId),
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ pool: result.value }, { status: 201 });
    }

    if (action === "adjust-pool") {
      const poolId = stringValue(body.poolId);
      if (!poolId || typeof body.delta !== "number") {
        return Response.json({ error: "Pool and adjustment are required" }, { status: 400 });
      }
      const result = await adjustStaffPool({
        eventSlug: slug,
        poolId,
        delta: body.delta,
        actorId,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ pool: result.value });
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
        actorId,
        overrides:
          body.overrides && typeof body.overrides === "object" && !Array.isArray(body.overrides)
            ? Object.fromEntries(
                STAFF_PERMISSIONS.flatMap((permission) => {
                  const value = (body.overrides as Record<string, unknown>)[permission];
                  return typeof value === "boolean" ? [[permission, value]] : [];
                }),
              )
            : undefined,
        scope:
          body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
            ? (body.scope as Record<string, unknown>)
            : undefined,
        expiresAt: stringValue(body.expiresAt),
      });
      return Response.json({ assignment: result }, { status: 201 });
    }

    if (action === "revoke-staff") {
      const assignmentId = stringValue(body.assignmentId);
      if (!assignmentId)
        return Response.json({ error: "Staff assignment is required" }, { status: 400 });
      const revoked = await revokeStaffAccess({ eventSlug: slug, assignmentId, actorId });
      return revoked
        ? Response.json({ revoked: true })
        : Response.json({ error: "Active staff assignment not found" }, { status: 404 });
    }

    if (action === "revoke-staff-device") {
      const assignmentId = stringValue(body.assignmentId);
      const deviceId = stringValue(body.deviceId);
      if (!assignmentId || !deviceId)
        return Response.json(
          { error: "Staff assignment and device are required" },
          { status: 400 },
        );
      const revoked = await revokeStaffAccessDevice({
        eventSlug: slug,
        assignmentId,
        deviceId,
        actorId,
      });
      return revoked
        ? Response.json({ revoked: true })
        : Response.json({ error: "Active staff device not found" }, { status: 404 });
    }

    if (action === "print-pack" || action === "print-pdf") {
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
        includeCutGuides: body.includeCutGuides !== false,
        includePageNumbers: body.includePageNumbers !== false,
        discoveryIds,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      if (action === "print-pdf") {
        const pdf = await renderDiscoveryPrintPdf(result);
        return new Response(new Uint8Array(pdf), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${slug}-discovery-pack.pdf"`,
            "Content-Type": "application/pdf",
          },
        });
      }
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "link-media") {
      const storageRef = stringValue(body.storageRef);
      if (!storageRef)
        return Response.json({ error: "A stored media reference is required" }, { status: 400 });
      const result = await createScoreMediaLink({
        eventSlug: slug,
        activityId: stringValue(body.activityId),
        transactionId: stringValue(body.transactionId),
        participantId: stringValue(body.participantId),
        staffActorId: actorId,
        storageRef,
        visibility:
          body.visibility === "event-album" || body.visibility === "discard"
            ? body.visibility
            : "admin-evidence",
        consentState:
          body.consentState === "requested" ||
          body.consentState === "obtained" ||
          body.consentState === "declined"
            ? body.consentState
            : "not-requested",
        expiresAt: stringValue(body.expiresAt),
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ media: result.value }, { status: 201 });
    }

    if (action === "media-consent") {
      const mediaId = stringValue(body.mediaId);
      const consentState = body.consentState;
      if (
        !mediaId ||
        !["not-requested", "requested", "obtained", "declined"].includes(String(consentState))
      )
        return Response.json({ error: "Media and consent state are required" }, { status: 400 });
      return Response.json({
        updated: await updateScoreMediaConsent(
          mediaId,
          consentState as "not-requested" | "requested" | "obtained" | "declined",
        ),
      });
    }

    if (action === "delete-media") {
      const mediaId = stringValue(body.mediaId);
      if (!mediaId) return Response.json({ error: "Media is required" }, { status: 400 });
      return Response.json({ deleted: await deleteScoreMediaLink(mediaId) });
    }

    if (action === "export") {
      const [settings, activities, participants, pools, discoveries, staff, audit, media] =
        await Promise.all([
          getScoring(slug),
          listScoringActivities(slug),
          listLeaderboardParticipants(slug),
          listPools(slug),
          listDiscoveries(slug),
          listStaffAssignments(slug),
          listScoreAuditEvents({ eventSlug: slug, limit: 500 }),
          listScoreMediaLinks(slug),
        ]);
      const exportData = {
        exportedAt: new Date().toISOString(),
        eventSlug: slug,
        settings,
        activities,
        participants,
        pools,
        discoveries,
        staff,
        audit,
        media,
      };
      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${slug}-scoring-export.json"`,
          "Content-Type": "application/json",
        },
      });
    }

    if (action === "merge-participants") {
      const sourceParticipantId = stringValue(body.sourceParticipantId);
      const targetParticipantId = stringValue(body.targetParticipantId);
      const reason = stringValue(body.reason);
      const evidence = Array.isArray(body.evidence)
        ? body.evidence.filter((item): item is string => typeof item === "string")
        : [];
      if (!sourceParticipantId || !targetParticipantId || !reason || evidence.length === 0)
        return Response.json(
          { error: "Two participants, evidence, and a reason are required" },
          { status: 400 },
        );
      const result = await mergeParticipants({
        eventSlug: slug,
        sourceParticipantId,
        targetParticipantId,
        actorId,
        reason,
        evidence,
      });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ merged: true });
    }

    if (action === "split-participants") {
      const mergeId = stringValue(body.mergeId);
      const reason = stringValue(body.reason);
      if (!mergeId || !reason)
        return Response.json({ error: "Merge and reason are required" }, { status: 400 });
      const result = await reverseParticipantMerge({ mergeId, actorId, reason });
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ split: true });
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
