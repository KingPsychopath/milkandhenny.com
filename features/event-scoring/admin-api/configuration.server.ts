import {
  changeScoringState,
  configureScoring,
  copyScoringActivity,
  createActivityFromPersonalTemplate,
  createScoringActivity,
  finalizeLeaderboard,
  savePersonalActivityTemplate,
  updateScoringActivity,
} from "../scoring.server";
import { isLeaderboardVisibility, isScoringState, type ScoreRule } from "../types";
import { resultResponse, stringValue, type AdminScoringActionHandlers } from "./shared";

export const configurationActions: AdminScoringActionHandlers = {
  state: async ({ eventSlug, actorId, body }) => {
    if (!isScoringState(body.state))
      return Response.json({ error: "Unknown scoring state" }, { status: 400 });
    return resultResponse(
      await changeScoringState({
        eventSlug,
        state: body.state,
        actorId,
        reason: stringValue(body.reason),
        force: body.force === true,
      }),
      "settings",
    );
  },

  settings: async ({ eventSlug, actorId, body }) => {
    const visibility = body.leaderboardVisibility;
    if (visibility !== undefined && !isLeaderboardVisibility(visibility))
      return Response.json({ error: "Unknown leaderboard visibility" }, { status: 400 });
    return resultResponse(
      await configureScoring({
        eventSlug,
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
        allowStaffSelfAwards:
          typeof body.allowStaffSelfAwards === "boolean" ? body.allowStaffSelfAwards : undefined,
      }),
      "settings",
    );
  },

  "create-activity": async ({ eventSlug, actorId, body }) => {
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
    return resultResponse(
      await createScoringActivity({
        eventSlug,
        actorId,
        name,
        template: template as Parameters<typeof createScoringActivity>[0]["template"],
        rule: body.rule as ScoreRule,
        status: stringValue(body.status) as Parameters<typeof createScoringActivity>[0]["status"],
        startsAt: stringValue(body.startsAt),
        endsAt: stringValue(body.endsAt),
      }),
      "activity",
      201,
    );
  },

  "update-activity": async ({ actorId, body }) => {
    const activityId = stringValue(body.activityId);
    if (!activityId) return Response.json({ error: "Activity is required" }, { status: 400 });
    return resultResponse(
      await updateScoringActivity({
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
      }),
      "activity",
    );
  },

  "copy-activity": async ({ eventSlug, actorId, body }) => {
    const activityId = stringValue(body.activityId);
    if (!activityId) return Response.json({ error: "Activity is required" }, { status: 400 });
    return resultResponse(
      await copyScoringActivity({
        activityId,
        targetEventSlug: stringValue(body.targetEventSlug) ?? eventSlug,
        actorId,
      }),
      "activity",
      201,
    );
  },

  "save-activity-template": async ({ actorId, body }) => {
    const activityId = stringValue(body.activityId);
    if (!activityId) return Response.json({ error: "Activity is required" }, { status: 400 });
    return resultResponse(
      await savePersonalActivityTemplate({
        activityId,
        actorId,
        name: stringValue(body.name),
      }),
      "personalTemplate",
      201,
    );
  },

  "create-from-activity-template": async ({ eventSlug, actorId, body }) => {
    const templateId = stringValue(body.templateId);
    if (!templateId)
      return Response.json({ error: "Personal template is required" }, { status: 400 });
    return resultResponse(
      await createActivityFromPersonalTemplate({
        eventSlug,
        templateId,
        actorId,
        name: stringValue(body.name),
      }),
      "activity",
      201,
    );
  },

  finalize: async ({ eventSlug, actorId, body }) => {
    if (typeof body.prizeSlots !== "number")
      return Response.json({ error: "Prize slots are required" }, { status: 400 });
    return resultResponse(
      await finalizeLeaderboard({
        eventSlug,
        actorId,
        prizeSlots: body.prizeSlots,
        resolvedTies: body.resolvedTies === true,
        reason: stringValue(body.reason),
      }),
      "finalization",
    );
  },
};
