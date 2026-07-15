import { createFileRoute } from "@tanstack/react-router";
import {
  clearBestDressedVotes,
  getBestDressedSnapshot,
  voteBestDressed,
} from "@/features/best-dressed/best-dressed.server";
import type { VoteInput } from "@/features/best-dressed/best-dressed.server";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  try {
    return Response.json(await getBestDressedSnapshot());
  } catch (error) {
    return apiErrorFromRequest(request, "best-dressed.list", "Failed to load voting data", error);
  }
}

async function handlePOST(request: Request) {
  try {
    const input: VoteInput = await request.json();
    const result = await voteBestDressed(input);
    return Response.json(result.ok ? { success: true, ...result } : result, {
      status: result.ok ? 200 : result.status,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.vote",
      "Failed to submit vote. Please try again.",
      error,
    );
  }
}

async function handleDELETE(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) return stepUpError;
  try {
    const result = await clearBestDressedVotes();
    return Response.json({ success: true, session: result.session });
  } catch (error) {
    return apiErrorFromRequest(request, "best-dressed.clear", "Failed to clear votes", error);
  }
}

export const Route = createFileRoute("/api/best-dressed")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
