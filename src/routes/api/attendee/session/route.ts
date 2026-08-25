import { createFileRoute } from "@tanstack/react-router";

import {
  attendeeAccount,
  attendeeEmailStepUpRequired,
  updateAttendeeName,
} from "@/features/attendee-access/access.server";
import {
  getAttendeeSession,
  signOutAttendeeSession,
} from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request): Promise<Response> {
  try {
    const session = await getAttendeeSession();
    if (!session?.personId)
      return Response.json({ authenticated: false, emailStepUpRequired: true });
    const account = await attendeeAccount(session.personId);
    return Response.json({
      authenticated: Boolean(account),
      account,
      emailStepUpRequired: attendeeEmailStepUpRequired(session.authenticatedAt),
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.session.read",
      "Your attendee access could not be loaded",
      error,
    );
  }
}

async function handlePATCH(request: Request): Promise<Response> {
  try {
    const session = await getAttendeeSession();
    if (!session?.personId) return Response.json({ error: "Sign in first" }, { status: 401 });
    const body: unknown = await request.json().catch(() => null);
    const name =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).name
        : undefined;
    const result = await updateAttendeeName(session.personId, typeof name === "string" ? name : "");
    return result.ok
      ? Response.json(result.value)
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.session.update",
      "Your details could not be updated",
      error,
    );
  }
}

async function handleDELETE(request: Request): Promise<Response> {
  try {
    await signOutAttendeeSession();
    return Response.json({ authenticated: false });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.session.sign-out",
      "Could not sign out on this device",
      error,
    );
  }
}

export const Route = createFileRoute("/api/attendee/session")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});

export { handleDELETE as DELETE, handleGET as GET, handlePATCH as PATCH };
