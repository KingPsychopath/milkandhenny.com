import { createFileRoute } from "@tanstack/react-router";

import {
  requestAttendeeAccess,
  requestFingerprint,
  verifyAttendeeAccess,
} from "@/features/attendee-access/access.server";
import {
  authenticateAttendeeSession,
  ensureAttendeeSession,
  getAttendeeSession,
} from "@/features/event-scoring/session.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function handlePOST(request: Request): Promise<Response> {
  try {
    const body = record(await request.json().catch(() => null));
    const session = await getAttendeeSession();
    const purpose = body.purpose === "add-email" ? "add-email" : "sign-in";
    const result = await requestAttendeeAccess({
      email: typeof body.email === "string" ? body.email : "",
      origin: getBaseUrlForRequest(request),
      ipFingerprint: requestFingerprint(request),
      returnTo: typeof body.returnTo === "string" ? body.returnTo : undefined,
      purpose,
      authenticatedPersonId: purpose === "add-email" ? session?.personId : undefined,
    });
    return result.ok
      ? Response.json(
          {
            sent: true,
            message: "If that address can receive mail, its private access link is on the way.",
          },
          { status: 202 },
        )
      : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.request",
      "The access email could not be requested",
      error,
    );
  }
}

async function handlePATCH(request: Request): Promise<Response> {
  try {
    const body = record(await request.json().catch(() => null));
    const session = await ensureAttendeeSession();
    const result = await verifyAttendeeAccess({
      sessionId: session.id,
      ipFingerprint: requestFingerprint(request),
      challengeId: typeof body.challengeId === "string" ? body.challengeId : undefined,
      token: typeof body.token === "string" ? body.token : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      code: typeof body.code === "string" ? body.code : undefined,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    await authenticateAttendeeSession({
      personId: result.value.personId,
      verifiedEmailHash: result.value.emailHash,
    });
    return Response.json({ authenticated: true, returnTo: result.value.returnTo });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "attendee-access.verify",
      "The access link could not be verified",
      error,
    );
  }
}

export const Route = createFileRoute("/api/attendee/access")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});

export { handlePATCH as PATCH, handlePOST as POST };
