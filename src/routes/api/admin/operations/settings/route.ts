import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import {
  countCapabilityImpact,
  getEventOperationsPolicy,
  getGlobalOperationsSettings,
  updateEventOperationsPolicy,
  updateGlobalOperationsSettings,
} from "@/features/attendee-operations/capabilities.server";
import { ATTENDEE_CAPABILITIES, effectiveCapability } from "@/features/attendee-operations/types";
import { listEvents } from "@/features/events/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const events = await listEvents({ includeHidden: true });
    const [global, policies, impactCounts] = await Promise.all([
      getGlobalOperationsSettings(),
      Promise.all(events.map((event) => getEventOperationsPolicy(event.slug))),
      Promise.all(ATTENDEE_CAPABILITIES.map((capability) => countCapabilityImpact(capability))),
    ]);
    return Response.json({
      global,
      impact: Object.fromEntries(
        ATTENDEE_CAPABILITIES.map((capability, index) => [capability, impactCounts[index]]),
      ),
      events: events.map((event, index) => ({
        slug: event.slug,
        title: event.title,
        status: event.status,
        policy: policies[index],
        effective: Object.fromEntries(
          ATTENDEE_CAPABILITIES.map((capability) => [
            capability,
            effectiveCapability(global, policies[index]!, capability),
          ]),
        ),
      })),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.settings.read",
      "Could not load settings",
      error,
    );
  }
}

async function handlePATCH(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  const actorId = auth.actorId ?? "root-owner";
  const actorType = auth.actorType === "admin" ? "admin" : "root-owner";
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
    if (body.scope === "global") {
      const stepUp = await requireAdminStepUp(request);
      if (stepUp) return stepUp;
      if (
        body.section !== "globalAvailability" &&
        body.section !== "newEventDefaults" &&
        body.section !== "emergencyPaused"
      ) {
        return Response.json({ error: "Unknown settings section" }, { status: 400 });
      }
      const global = await updateGlobalOperationsSettings({
        section: body.section,
        values:
          body.values && typeof body.values === "object" && !Array.isArray(body.values)
            ? body.values
            : {},
        actorId,
        actorType,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return Response.json({ global });
    }
    if (body.scope === "event" && typeof body.eventSlug === "string") {
      const stepUp = await requireAdminStepUp(request);
      if (stepUp) return stepUp;
      const policy = await updateEventOperationsPolicy({
        eventSlug: body.eventSlug,
        capabilities:
          body.capabilities &&
          typeof body.capabilities === "object" &&
          !Array.isArray(body.capabilities)
            ? body.capabilities
            : undefined,
        transferOpensAt:
          body.transferOpensAt === null || typeof body.transferOpensAt === "string"
            ? body.transferOpensAt
            : undefined,
        transferClosesAt:
          body.transferClosesAt === null || typeof body.transferClosesAt === "string"
            ? body.transferClosesAt
            : undefined,
        actorId,
        actorType,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      });
      return Response.json({ policy });
    }
    if (body.scope === "event-bulk" && Array.isArray(body.eventSlugs)) {
      const stepUp = await requireAdminStepUp(request);
      if (stepUp) return stepUp;
      const eventSlugs = [...new Set(body.eventSlugs)].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (eventSlugs.length < 1 || eventSlugs.length > 100) {
        return Response.json({ error: "Choose between 1 and 100 events" }, { status: 400 });
      }
      const knownEvents = new Set(
        (await listEvents({ includeHidden: true })).map((event) => event.slug),
      );
      if (eventSlugs.some((slug) => !knownEvents.has(slug))) {
        return Response.json({ error: "One or more events were not found" }, { status: 404 });
      }
      const policies = await Promise.all(
        eventSlugs.map((eventSlug) =>
          updateEventOperationsPolicy({
            eventSlug,
            capabilities:
              body.capabilities &&
              typeof body.capabilities === "object" &&
              !Array.isArray(body.capabilities)
                ? body.capabilities
                : undefined,
            transferOpensAt:
              body.transferOpensAt === null || typeof body.transferOpensAt === "string"
                ? body.transferOpensAt
                : undefined,
            transferClosesAt:
              body.transferClosesAt === null || typeof body.transferClosesAt === "string"
                ? body.transferClosesAt
                : undefined,
            actorId,
            actorType,
            reason: typeof body.reason === "string" ? body.reason : undefined,
          }),
        ),
      );
      return Response.json({ policies });
    }
    return Response.json({ error: "Unknown settings scope" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settings could not be saved";
    return message.includes("require") || message.includes("invalid") || message.includes("must")
      ? Response.json({ error: message }, { status: 400 })
      : apiErrorFromRequest(
          request,
          "attendee-operations.settings.update",
          "Could not save settings",
          error,
        );
  }
}

export const Route = createFileRoute("/api/admin/operations/settings")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});
