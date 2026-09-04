import { createServerFn } from "@tanstack/react-start";

import { getRequest } from "@tanstack/react-start/server";
import { authenticateRequest, getClientIp } from "@/features/auth/auth.server";
import {
  getSurveyExperience,
  listSurveyInvitations,
  listSurveyResponses,
  listSurveys,
  saveSurvey,
  reserveSurveySubmission,
  submitSurvey,
  type SurveyRecord,
} from "./surveys.server";

export const getPublicSurveyFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string; invite?: string }) => data)
  .handler(async ({ data }) => getSurveyExperience(data.slug, data.invite));

export const submitSurveyFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      slug: string;
      respondentName?: string;
      respondentEmail?: string;
      invitationToken?: string;
      submitAnonymously?: boolean;
      answers: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const limit = await reserveSurveySubmission(data.slug, getClientIp(getRequest()));
    if (!limit.allowed) {
      throw new Error("Too many survey responses from this network. Try again in a little while.");
    }
    return submitSurvey(data);
  });

export const getAdminSurveysFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await authenticateRequest(getRequest(), "admin");
  if (!auth.ok) return { authorised: false as const, surveys: [] };
  return { authorised: true as const, surveys: await listSurveys() };
});

export const saveAdminSurveyFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      id?: string;
      slug: string;
      eventSlug?: string | null;
      title: string;
      intro: string;
      questions: unknown;
      identityMode: SurveyRecord["identityMode"];
      status: SurveyRecord["status"];
    }) => data,
  )
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const, survey: null };
    return { authorised: true as const, survey: await saveSurvey(data) };
  });

export const getAdminSurveyResponsesFn = createServerFn({ method: "GET" })
  .validator((data: { surveyId: string }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const, responses: [], invitations: [] };
    const [responses, invitations] = await Promise.all([
      listSurveyResponses(data.surveyId),
      listSurveyInvitations(data.surveyId),
    ]);
    return { authorised: true as const, responses, invitations };
  });
