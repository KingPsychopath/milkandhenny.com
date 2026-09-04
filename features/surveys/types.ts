export const SURVEY_QUESTION_TYPES = [
  "rating",
  "long_text",
  "single_choice",
  "multi_choice",
  "yes_no",
  "email",
] as const;

export const SURVEY_IDENTITY_MODES = ["anonymous", "optional", "identified"] as const;
export type SurveyIdentityMode = (typeof SURVEY_IDENTITY_MODES)[number];

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
  identityMode: SurveyIdentityMode;
  status: "draft" | "open" | "closed" | "archived";
  responseCount: number;
  invitations: {
    issued: number;
    opened: number;
    completed: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type SurveyResponse = {
  id: string;
  respondentEmail: string | null;
  respondentName: string | null;
  identitySource: "anonymous" | "provided" | "invitation";
  answers: Record<string, string | string[]>;
  submittedAt: string;
};

export type SurveyInvitationAdmin = {
  id: string;
  respondentEmail: string;
  respondentName: string | null;
  openedAt: string | null;
  completedAt: string | null;
  completionMode: "anonymous" | "identified" | null;
  expiresAt: string;
};

export type SurveyInvitationContext = {
  id: string;
  token: string;
  respondentEmail: string;
  respondentName: string | null;
  identityMode: Exclude<SurveyIdentityMode, "anonymous">;
  completed: boolean;
};
