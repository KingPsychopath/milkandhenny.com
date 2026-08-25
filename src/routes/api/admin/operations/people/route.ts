import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuthWithPayload } from "@/features/auth/auth.server";
import { searchPeople } from "@/features/attendee-operations/directory.server";
import {
  forceSignOutPerson,
  restorePersonAcquisition,
  restrictPersonAcquisition,
} from "@/features/attendee-operations/identity-manager.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  try {
    const search = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ people: await searchPeople(search) });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-operations.people",
      "Could not search people",
      error,
    );
  }
}

async function handlePATCH(request: Request) {
  const auth = await requireAuthWithPayload(request, "admin");
  if (auth.error) return auth.error;
  const stepUp = await requireAdminStepUp(request);
  if (stepUp) return stepUp;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      typeof body.personId !== "string" ||
      typeof body.reason !== "string" ||
      (body.action !== "sign-out" && body.action !== "restrict" && body.action !== "restore")
    ) {
      return Response.json({ error: "Person, action, and reason are required" }, { status: 400 });
    }
    const actorId = auth.actorId ?? "root-owner";
    const actorType = auth.actorType === "admin" ? "admin" : "root-owner";
    const result =
      body.action === "sign-out"
        ? await forceSignOutPerson({
            personId: body.personId,
            actorId,
            actorType,
            reason: body.reason,
          })
        : body.action === "restrict"
          ? await restrictPersonAcquisition({
              personId: body.personId,
              actorId,
              actorType,
              reason: body.reason,
            })
          : await restorePersonAcquisition({
              personId: body.personId,
              actorId,
              actorType,
              reason: body.reason,
            });
    return result
      ? Response.json({ action: body.action, ...result })
      : Response.json({ error: "Person not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Identity access could not be updated";
    if (message.includes("reason between")) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "attendee-operations.identity",
      "Could not update identity access",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/operations/people")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});
