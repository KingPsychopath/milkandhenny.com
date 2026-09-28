import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { listSurveyInvitations, listSurveyResponses } from "./surveys.server";

export const readAdminSurveyResponsesFn = createServerFn({ method: "GET" })
  .validator((surveyId: string) => {
    if (typeof surveyId !== "string" || !surveyId.trim() || surveyId.length > 160)
      throw new Error("Choose a survey");
    return surveyId;
  })
  .handler(async ({ data: surveyId }) => {
    const access = await getAdminWorkspaceAccess(getRequest());
    if (!access.ok || !access.permissions.manageCommunications)
      throw new Error("Communications access required");
    const [responses, invitations] = await Promise.all([
      listSurveyResponses(surveyId),
      listSurveyInvitations(surveyId),
    ]);
    return { responses, invitations };
  });
