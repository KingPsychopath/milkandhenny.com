import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import {
  listCommunicationContacts,
  listCommunicationEvents,
  listCommunicationMessages,
  saveCommunication,
  setMarketingPreference,
} from "@/features/communications/communications.server";
import {
  archiveCommunicationTemplate,
  createStarterPlan,
  listCommunicationPlans,
  listCommunicationStageDeliveries,
  listCommunicationTemplates,
  pauseCommunicationPlan,
  saveCommunicationTemplate,
  scheduleCommunicationPlan,
  sendCommunicationStageNow,
  sendCommunicationStageToMissingRecipients,
  previewCommunicationStage,
  previewCommunicationStageEmail,
  resetCommunicationPlanStageFromTemplate,
  sendCommunicationPlanTest,
  updateCommunicationPlanStage,
} from "@/features/communications/communication-plans.server";
import { listSurveys } from "@/features/surveys/surveys.server";
import { getEvent } from "@/features/events/store.server";
import {
  renderCommunicationMessage,
  type CommunicationMedia,
} from "@/features/communications/email.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { describeEmailCapability } from "@/lib/platform/email.server";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("scope") === "event-plan") {
      const eventSlug = url.searchParams.get("eventSlug")?.trim();
      if (!eventSlug) return Response.json({ error: "Choose an event" }, { status: 400 });
      return Response.json({ plans: await listCommunicationPlans(eventSlug) });
    }
    const [contacts, messages, events, plans, templates, surveys] = await Promise.all([
      listCommunicationContacts(),
      listCommunicationMessages(),
      listCommunicationEvents(),
      listCommunicationPlans(),
      listCommunicationTemplates(),
      listSurveys(),
    ]);
    return Response.json({
      contacts,
      messages,
      events,
      plans,
      templates,
      surveys,
      email: describeEmailCapability(),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.communications",
      "Could not load communications",
      error,
    );
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "set-preference") {
      if (typeof body.emailHash !== "string" || typeof body.optedIn !== "boolean") {
        return Response.json(
          { error: "Choose a contact and a marketing preference" },
          { status: 400 },
        );
      }
      await setMarketingPreference(body.emailHash, body.optedIn);
      return Response.json({ ok: true });
    }
    if (body.action === "preview") {
      const kind = body.kind;
      if (
        kind !== "newsletter" &&
        kind !== "event_update" &&
        kind !== "pitch_nudge" &&
        kind !== "event_service" &&
        kind !== "feedback"
      ) {
        return Response.json({ error: "Choose a valid message type" }, { status: 400 });
      }
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      const messageBody = typeof body.messageBody === "string" ? body.messageBody.trim() : "";
      if (!subject || !messageBody)
        return Response.json({ error: "Add a subject and message first" }, { status: 400 });
      const event =
        typeof body.eventSlug === "string" && body.eventSlug
          ? ((await getEvent(body.eventSlug)) ?? undefined)
          : undefined;
      const rendered = renderCommunicationMessage({
        kind,
        subject,
        body: messageBody,
        media: Array.isArray(body.media) ? (body.media as CommunicationMedia[]) : [],
        origin: getBaseUrlForRequest(request),
        context: { event },
        meta: event?.title,
      });
      return Response.json({ rendered });
    }
    if (body.action === "create-starter-plan") {
      if (typeof body.eventSlug !== "string" || !body.eventSlug)
        return Response.json({ error: "Choose an event" }, { status: 400 });
      return Response.json({ plan: await createStarterPlan(body.eventSlug) });
    }
    if (body.action === "schedule-plan" || body.action === "pause-plan") {
      if (typeof body.planId !== "string" || !body.planId)
        return Response.json({ error: "Choose a plan" }, { status: 400 });
      if (body.action === "schedule-plan") await scheduleCommunicationPlan(body.planId);
      else await pauseCommunicationPlan(body.planId);
      return Response.json({ ok: true });
    }
    if (body.action === "update-stage") {
      if (
        typeof body.stageId !== "string" ||
        typeof body.subject !== "string" ||
        typeof body.messageBody !== "string"
      ) {
        return Response.json({ error: "The stage needs a subject and message" }, { status: 400 });
      }
      await updateCommunicationPlanStage({
        id: body.stageId,
        subject: body.subject,
        body: body.messageBody,
        media: body.media,
        sendAt: typeof body.sendAt === "string" && body.sendAt ? body.sendAt : null,
      });
      return Response.json({ ok: true });
    }
    if (body.action === "preview-stage") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      return Response.json(await previewCommunicationStage(body.stageId));
    }
    if (body.action === "stage-deliveries") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      return Response.json({ deliveries: await listCommunicationStageDeliveries(body.stageId) });
    }
    if (body.action === "preview-stage-email") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      return Response.json({
        rendered: await previewCommunicationStageEmail(body.stageId, request),
      });
    }
    if (body.action === "reset-stage-template") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      await resetCommunicationPlanStageFromTemplate(body.stageId);
      return Response.json({ ok: true });
    }
    if (body.action === "send-test-plan") {
      if (typeof body.planId !== "string" || !body.planId || typeof body.testEmail !== "string") {
        return Response.json(
          { error: "Choose an event plan and test email address" },
          { status: 400 },
        );
      }
      return Response.json({
        queued: await sendCommunicationPlanTest(body.planId, body.testEmail, request),
      });
    }
    if (body.action === "send-stage-now") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      return Response.json({ queued: await sendCommunicationStageNow(body.stageId, request) });
    }
    if (body.action === "send-stage-to-missing") {
      if (typeof body.stageId !== "string" || !body.stageId)
        return Response.json({ error: "Choose a stage" }, { status: 400 });
      return Response.json({
        queued: await sendCommunicationStageToMissingRecipients(body.stageId, request),
      });
    }
    if (body.action === "save-template") {
      if (
        typeof body.name !== "string" ||
        typeof body.kind !== "string" ||
        typeof body.subject !== "string" ||
        typeof body.messageBody !== "string"
      ) {
        return Response.json(
          { error: "The template needs a name, type, subject, and message" },
          { status: 400 },
        );
      }
      const kind = body.kind;
      if (
        !["newsletter", "event_update", "pitch_nudge", "event_service", "feedback"].includes(kind)
      ) {
        return Response.json({ error: "Choose a valid template type" }, { status: 400 });
      }
      return Response.json({
        template: await saveCommunicationTemplate({
          id: typeof body.templateId === "string" ? body.templateId : undefined,
          name: body.name,
          kind: kind as
            | "newsletter"
            | "event_update"
            | "pitch_nudge"
            | "event_service"
            | "feedback",
          subject: body.subject,
          body: body.messageBody,
          media: body.media,
          isDefault: body.isDefault === true,
        }),
      });
    }
    if (body.action === "archive-template") {
      if (typeof body.templateId !== "string" || !body.templateId)
        return Response.json({ error: "Choose a template" }, { status: 400 });
      await archiveCommunicationTemplate(body.templateId);
      return Response.json({ ok: true });
    }
    const kind = body.kind;
    if (
      kind !== "newsletter" &&
      kind !== "event_update" &&
      kind !== "pitch_nudge" &&
      kind !== "event_service" &&
      kind !== "feedback"
    ) {
      return Response.json({ error: "Choose a message type" }, { status: 400 });
    }
    const data = await saveCommunication({
      kind,
      audience: typeof body.audience === "string" ? body.audience : "",
      eventSlug: typeof body.eventSlug === "string" ? body.eventSlug : null,
      subject: typeof body.subject === "string" ? body.subject : "",
      body: typeof body.body === "string" ? body.body : "",
      media: body.media,
      selectedContactHashes: Array.isArray(body.selectedContactHashes)
        ? body.selectedContactHashes.filter((value): value is string => typeof value === "string")
        : [],
      scheduledAt:
        typeof body.scheduledAt === "string" && body.scheduledAt ? body.scheduledAt : null,
      request,
    });
    return Response.json({ communication: data });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "admin.communications",
      "Could not save communication",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/communications")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
