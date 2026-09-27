import { queryOptions } from "@tanstack/react-query";
import { readAdminSurveyResponsesFn } from "./admin-survey-responses.functions";

export const adminSurveyResponsesQuery = (surveyId: string) =>
  queryOptions({
    queryKey: ["admin", "communications", "survey-responses", surveyId] as const,
    queryFn: () => readAdminSurveyResponsesFn({ data: surveyId }),
    staleTime: 10_000,
  });
