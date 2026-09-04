import { createFileRoute } from "@tanstack/react-router";

import { requireAuth } from "@/features/auth/auth.server";
import { listPolls } from "@/features/polls/polls.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const Route = createFileRoute("/api/admin/polls/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authError = await requireAuth(request, "admin");
        if (authError) return authError;
        try {
          const poll = (await listPolls()).find((item) => item.id === params.id) ?? null;
          return poll
            ? Response.json({ poll })
            : Response.json({ error: "Poll not found" }, { status: 404 });
        } catch (error) {
          return apiErrorFromRequest(
            request,
            "admin.poll-results",
            "Could not load poll results",
            error,
          );
        }
      },
    },
  },
});
