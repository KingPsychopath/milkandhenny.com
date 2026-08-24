import { createServerFn } from "@tanstack/react-start";

import { getRequest } from "@tanstack/react-start/server";
import { authenticateRequest } from "@/features/auth/auth.server";
import {
  getSurvey,
  listSurveyResponses,
  listSurveys,
  saveSurvey,
  submitSurvey,
  type SurveyRecord,
} from "./surveys.server";

export const getPublicSurveyFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }) => getSurvey(data.slug));

export const submitSurveyFn = createServerFn({ method: "POST" })
  .validator((data: { slug: string; respondentName?: string; respondentEmail?: string; answers: Record<string, unknown> }) => data)
  .handler(async ({ data }) => submitSurvey(data));

export const getAdminSurveysFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await authenticateRequest(getRequest(), "admin");
  if (!auth.ok) return { authorised: false as const, surveys: [] };
  return { authorised: true as const, surveys: await listSurveys() };
});

export const saveAdminSurveyFn = createServerFn({ method: "POST" })
  .validator((data: { id?: string; slug: string; eventSlug?: string | null; title: string; intro: string; questions: unknown; status: SurveyRecord["status"] }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const, survey: null };
    return { authorised: true as const, survey: await saveSurvey(data) };
  });

export const getAdminSurveyResponsesFn = createServerFn({ method: "GET" })
  .validator((data: { surveyId: string }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const, responses: [] };
    return { authorised: true as const, responses: await listSurveyResponses(data.surveyId) };
  });
