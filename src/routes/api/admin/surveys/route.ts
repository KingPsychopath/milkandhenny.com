import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { listSurveys, saveSurvey, type SurveyRecord } from "@/features/surveys/surveys.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    return Response.json({ surveys: await listSurveys() });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.surveys", "Could not load surveys", error);
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const status = body.status;
    if (status !== "draft" && status !== "open" && status !== "closed" && status !== "archived") {
      return Response.json({ error: "Choose a survey status" }, { status: 400 });
    }
    const survey = await saveSurvey({
      id: typeof body.id === "string" ? body.id : undefined,
      slug: typeof body.slug === "string" ? body.slug : "",
      eventSlug: typeof body.eventSlug === "string" && body.eventSlug ? body.eventSlug : null,
      title: typeof body.title === "string" ? body.title : "",
      intro: typeof body.intro === "string" ? body.intro : "",
      questions: body.questions,
      status: status as SurveyRecord["status"],
    });
    return Response.json({ survey });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.surveys", "Could not save survey", error);
  }
}

export const Route = createFileRoute("/api/admin/surveys")({
  server: { handlers: { GET: ({ request }) => handleGET(request), POST: ({ request }) => handlePOST(request) } },
});
