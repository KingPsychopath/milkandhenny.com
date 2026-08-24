import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { listSurveyResponses } from "@/features/surveys/surveys.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const Route = createFileRoute("/api/admin/surveys/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authError = await requireAuth(request, "admin");
        if (authError) return authError;
        try {
          return Response.json({ responses: await listSurveyResponses(params.id) });
        } catch (error) {
          return apiErrorFromRequest(
            request,
            "admin.survey-responses",
            "Could not load feedback",
            error,
          );
        }
      },
    },
  },
});
