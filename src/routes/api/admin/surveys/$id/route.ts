import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { listSurveyInvitations, listSurveyResponses } from "@/features/surveys/surveys.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const Route = createFileRoute("/api/admin/surveys/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authError = await requireAuth(request, "admin");
        if (authError) return authError;
        try {
          const [responses, invitations] = await Promise.all([
            listSurveyResponses(params.id),
            listSurveyInvitations(params.id),
          ]);
          return Response.json({ responses, invitations });
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
