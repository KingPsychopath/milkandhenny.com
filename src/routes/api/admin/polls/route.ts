import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { listPolls, savePoll } from "@/features/polls/polls.server";
import {
  POLL_RESULT_VISIBILITIES,
  POLL_SELECTION_MODES,
  POLL_STATUSES,
} from "@/features/polls/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json({ polls: await listPolls() });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.polls", "Could not load polls", error);
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!POLL_STATUSES.includes(body.status as (typeof POLL_STATUSES)[number])) {
      return Response.json({ error: "Choose a poll status" }, { status: 400 });
    }
    if (
      !POLL_SELECTION_MODES.includes(body.selectionMode as (typeof POLL_SELECTION_MODES)[number])
    ) {
      return Response.json({ error: "Choose how people can answer" }, { status: 400 });
    }
    if (
      !POLL_RESULT_VISIBILITIES.includes(
        body.resultVisibility as (typeof POLL_RESULT_VISIBILITIES)[number],
      )
    ) {
      return Response.json({ error: "Choose when results are visible" }, { status: 400 });
    }
    const poll = await savePoll({
      id: typeof body.id === "string" && body.id ? body.id : undefined,
      slug: typeof body.slug === "string" ? body.slug : "",
      eventSlug: typeof body.eventSlug === "string" && body.eventSlug ? body.eventSlug : null,
      title: typeof body.title === "string" ? body.title : "",
      intro: typeof body.intro === "string" ? body.intro : "",
      question: typeof body.question === "string" ? body.question : "",
      options: body.options,
      selectionMode: body.selectionMode as (typeof POLL_SELECTION_MODES)[number],
      resultVisibility: body.resultVisibility as (typeof POLL_RESULT_VISIBILITIES)[number],
      showPercentages: body.showPercentages === true,
      status: body.status as (typeof POLL_STATUSES)[number],
    });
    return Response.json({ poll });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.polls", "Could not save poll", error);
  }
}

export const Route = createFileRoute("/api/admin/polls")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
