export const SURVEY_QUESTION_TYPES = [
  "rating",
  "long_text",
  "single_choice",
  "multi_choice",
  "yes_no",
  "email",
] as const;

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export type SurveyQuestion = {
  id: string;
  type: SurveyQuestionType;
  label: string;
  hint?: string;
  required: boolean;
  options?: string[];
};

export type SurveyRecord = {
  id: string;
  slug: string;
  eventSlug: string | null;
  title: string;
  intro: string;
  questions: SurveyQuestion[];
  status: "draft" | "open" | "closed" | "archived";
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SurveyResponse = {
  id: string;
  respondentEmail: string | null;
  respondentName: string | null;
  answers: Record<string, string | string[]>;
  submittedAt: string;
};
