import { createHash, randomUUID } from "node:crypto";

import { query, transaction } from "@/lib/platform/postgres.server";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";
import { isValidEmail } from "@/lib/shared/email-address";
import {
  SURVEY_QUESTION_TYPES,
  SURVEY_IDENTITY_MODES,
  type SurveyIdentityMode,
  type SurveyInvitationAdmin,
  type SurveyInvitationContext,
  type SurveyQuestion,
  type SurveyRecord,
  type SurveyResponse,
  type SurveyQuestionType,
} from "./types";
import { resolveSurveyInvitation } from "./invitations.server";

export { SURVEY_QUESTION_TYPES, SURVEY_IDENTITY_MODES } from "./types";
export type {
  SurveyIdentityMode,
  SurveyInvitationAdmin,
  SurveyQuestion,
  SurveyRecord,
  SurveyResponse,
  SurveyQuestionType,
} from "./types";

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function asQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const type = SURVEY_QUESTION_TYPES.includes(item.type as SurveyQuestionType)
        ? (item.type as SurveyQuestionType)
        : "long_text";
      const options = Array.isArray(item.options)
        ? item.options.filter((option): option is string => typeof option === "string").slice(0, 12)
        : undefined;
      return {
        id: typeof item.id === "string" && item.id ? item.id.slice(0, 80) : `question-${index + 1}`,
        type,
        label: typeof item.label === "string" ? item.label.trim().slice(0, 240) : "Question",
        hint:
          typeof item.hint === "string" && item.hint.trim()
            ? item.hint.trim().slice(0, 400)
            : undefined,
        required: item.required !== false,
        ...(options && options.length > 0 ? { options } : {}),
      };
    })
    .filter((question) => question.label.length > 0)
    .slice(0, 20);
}

function fromRow(row: Record<string, unknown>): SurveyRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    eventSlug: typeof row.event_slug === "string" ? row.event_slug : null,
    title: String(row.title),
    intro: String(row.intro ?? ""),
    questions: asQuestions(row.questions),
    identityMode: SURVEY_IDENTITY_MODES.includes(row.identity_mode as SurveyIdentityMode)
      ? (row.identity_mode as SurveyIdentityMode)
      : "optional",
    status: row.status as SurveyRecord["status"],
    responseCount: Number(row.response_count) || 0,
    invitations: {
      issued: Number(row.invitations_issued) || 0,
      opened: Number(row.invitations_opened) || 0,
      completed: Number(row.invitations_completed) || 0,
    },
    createdAt: asIso(row.created_at as Date),
    updatedAt: asIso(row.updated_at as Date),
  };
}

function normaliseSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const SURVEY_SUBMISSION_LIMIT_PER_NETWORK = 300;
const SURVEY_SUBMISSION_GLOBAL_LIMIT = 10_000;
const SURVEY_SUBMISSION_WINDOW_SECONDS = 60 * 60;

/**
 * Keep public surveys usable on shared event Wi-Fi while bounding anonymous
 * database writes from one network and across the whole service.
 */
export async function reserveSurveySubmission(
  slug: string,
  sourceIp: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const decision = await reserveRateLimit({
    name: "survey-submit",
    identity: `${normaliseSlug(slug) || "unknown"}:${sourceIp || "unknown"}`,
    limit: SURVEY_SUBMISSION_LIMIT_PER_NETWORK,
    windowSeconds: SURVEY_SUBMISSION_WINDOW_SECONDS,
    globalLimit: SURVEY_SUBMISSION_GLOBAL_LIMIT,
  });
  return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
}

export async function listSurveys(): Promise<SurveyRecord[]> {
  const rows = await query<Record<string, unknown>>(`
    select s.id, s.slug, s.event_slug, s.title, s.intro, s.questions, s.identity_mode,
           s.status, s.response_count,
           (select count(*) from survey_invitations i where i.survey_id = s.id) as invitations_issued,
           (select count(*) from survey_invitations i where i.survey_id = s.id and i.opened_at is not null) as invitations_opened,
           (select count(*) from survey_invitations i where i.survey_id = s.id and i.completed_at is not null) as invitations_completed,
           created_at, updated_at
      from surveys s
     where s.status <> 'archived'
     order by s.updated_at desc
  `);
  return rows.map(fromRow);
}

export async function getSurvey(slug: string, includeDraft = false): Promise<SurveyRecord | null> {
  const rows = await query<Record<string, unknown>>(
    `select s.id, s.slug, s.event_slug, s.title, s.intro, s.questions, s.identity_mode,
            s.status, s.response_count,
            (select count(*) from survey_invitations i where i.survey_id = s.id) as invitations_issued,
            (select count(*) from survey_invitations i where i.survey_id = s.id and i.opened_at is not null) as invitations_opened,
            (select count(*) from survey_invitations i where i.survey_id = s.id and i.completed_at is not null) as invitations_completed,
            created_at, updated_at
       from surveys s
      where s.slug = $1
        and ($2 or s.status in ('open', 'closed'))
      limit 1`,
    [normaliseSlug(slug), includeDraft],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getSurveyExperience(
  slug: string,
  invitationToken?: string,
): Promise<{ survey: SurveyRecord; invitation: SurveyInvitationContext | null } | null> {
  const survey = await getSurvey(slug);
  if (!survey) return null;
  const invitation = await resolveSurveyInvitation(invitationToken, survey.slug, true);
  return { survey, invitation };
}

export async function saveSurvey(input: {
  id?: string;
  slug: string;
  eventSlug?: string | null;
  title: string;
  intro: string;
  questions: unknown;
  identityMode: SurveyIdentityMode;
  status: SurveyRecord["status"];
}): Promise<SurveyRecord> {
  const slug = normaliseSlug(input.slug);
  const title = input.title.trim().slice(0, 160);
  const intro = input.intro.trim().slice(0, 2000);
  const questions = asQuestions(input.questions);
  if (!SURVEY_IDENTITY_MODES.includes(input.identityMode))
    throw new Error("Choose how responses are identified");
  if (!slug || !title || questions.length === 0)
    throw new Error("Add a title and at least one question");
  if (input.status === "open" && questions.some((question) => !question.label)) {
    throw new Error("Every question needs a label");
  }
  const id = input.id || randomUUID();
  const saved = await query<{ id: string }>(
    `insert into surveys (id, slug, event_slug, title, intro, questions, identity_mode, status)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
     on conflict (id) do update set
       slug = excluded.slug,
       event_slug = excluded.event_slug,
       title = excluded.title,
       intro = excluded.intro,
       questions = excluded.questions,
       identity_mode = excluded.identity_mode,
       status = excluded.status,
       updated_at = now()
     where surveys.response_count = 0
        or (surveys.questions = excluded.questions and surveys.identity_mode = excluded.identity_mode)
     returning id`,
    [
      id,
      slug,
      input.eventSlug || null,
      title,
      intro,
      JSON.stringify(questions),
      input.identityMode,
      input.status,
    ],
  );
  if (saved.length === 0)
    throw new Error(
      "Questions and identity cannot change after responses begin. Create another survey.",
    );
  const survey = await getSurvey(slug, true);
  if (!survey) throw new Error("Survey was not saved");
  return survey;
}

function cleanAnswer(question: SurveyQuestion, value: unknown): string | string[] | null {
  if (question.type === "multi_choice") {
    if (!Array.isArray(value)) return null;
    const options = new Set(question.options ?? []);
    const values = value
      .filter((item): item is string => typeof item === "string" && options.has(item))
      .slice(0, options.size);
    return values.length ? values : null;
  }
  if (typeof value !== "string") return null;
  const answer = value.trim().slice(0, 4000);
  if (!answer) return null;
  if (
    question.type === "rating" &&
    (!/^[1-5]$/.test(answer) || Number(answer) < 1 || Number(answer) > 5)
  )
    return null;
  if (question.type === "yes_no" && answer !== "yes" && answer !== "no") return null;
  if (question.type === "single_choice" && !(question.options ?? []).includes(answer)) return null;
  if (question.type === "email" && !isValidEmail(answer)) return null;
  return answer;
}

export async function submitSurvey(input: {
  slug: string;
  respondentName?: string;
  respondentEmail?: string;
  invitationToken?: string;
  submitAnonymously?: boolean;
  answers: Record<string, unknown>;
}): Promise<{ accepted: true; alreadySubmitted: boolean }> {
  const survey = await getSurvey(input.slug);
  if (!survey || survey.status !== "open") throw new Error("This survey is not open");
  const invitation = await resolveSurveyInvitation(input.invitationToken, survey.slug);
  if (survey.identityMode === "identified" && !invitation) {
    throw new Error("Open the personal survey link from your email to respond");
  }
  const answers: Record<string, string | string[]> = {};
  for (const question of survey.questions) {
    const answer = cleanAnswer(question, input.answers[question.id]);
    if (question.required && answer === null)
      throw new Error(`Answer “${question.label}” to continue`);
    if (answer !== null) answers[question.id] = answer;
  }
  const anonymous =
    survey.identityMode === "anonymous" ||
    (survey.identityMode === "optional" && Boolean(input.submitAnonymously));
  const invitedIdentity = !anonymous ? invitation : null;
  const email = anonymous
    ? null
    : invitedIdentity?.respondentEmail || input.respondentEmail?.trim().toLowerCase() || null;
  if (email && !isValidEmail(email)) throw new Error("Enter a valid email address");
  const emailHash = email ? hashEmail(email) : null;
  const respondentName = anonymous
    ? null
    : invitedIdentity?.respondentName || input.respondentName?.trim().slice(0, 160) || null;
  const invitationId = invitedIdentity?.id ?? null;
  const identitySource = invitationId ? "invitation" : email ? "provided" : "anonymous";
  const inserted = await transaction(async (client) => {
    const locked = await client.query<Record<string, unknown>>(
      "select * from surveys where id=$1 for update",
      [survey.id],
    );
    const current = locked.rows[0] ? fromRow(locked.rows[0]) : null;
    if (!current || current.status !== "open") throw new Error("This survey is not open");
    if (
      JSON.stringify(current.questions) !== JSON.stringify(survey.questions) ||
      current.identityMode !== survey.identityMode
    )
      throw new Error("This survey changed. Reload its questions before responding.");
    if (invitation) {
      const claimed = await client.query<{ id: string }>(
        `update survey_invitations
            set completed_at = now(), completion_mode = $2, updated_at = now()
          where id = $1 and completed_at is null
          returning id`,
        [invitation.id, anonymous ? "anonymous" : "identified"],
      );
      if (!claimed.rows[0]) return false;
    }
    const result = await client.query<{ id: string }>(
      `insert into survey_responses
         (id, survey_id, respondent_email, email_hash, respondent_name, answers,
          invitation_id, identity_source)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       on conflict do nothing
       returning id`,
      [
        randomUUID(),
        survey.id,
        email,
        emailHash,
        respondentName,
        JSON.stringify(answers),
        invitationId,
        identitySource,
      ],
    );
    if (result.rows[0]) {
      await client.query(
        `update surveys set response_count = response_count + 1, updated_at = now() where id = $1`,
        [survey.id],
      );
    }
    return Boolean(result.rows[0]);
  });
  return {
    accepted: true,
    alreadySubmitted: !inserted && Boolean(emailHash || invitationId),
  };
}

export async function listSurveyResponses(surveyId: string): Promise<SurveyResponse[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, respondent_email, respondent_name, identity_source, answers, submitted_at
       from survey_responses
      where survey_id = $1
      order by submitted_at desc`,
    [surveyId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    respondentEmail: typeof row.respondent_email === "string" ? row.respondent_email : null,
    respondentName: typeof row.respondent_name === "string" ? row.respondent_name : null,
    identitySource: row.identity_source as SurveyResponse["identitySource"],
    answers: (row.answers && typeof row.answers === "object" ? row.answers : {}) as Record<
      string,
      string | string[]
    >,
    submittedAt: asIso(row.submitted_at as Date),
  }));
}

export async function listSurveyInvitations(surveyId: string): Promise<SurveyInvitationAdmin[]> {
  const rows = await query<Record<string, unknown>>(
    `select i.id, c.email, c.display_name, i.opened_at, i.completed_at,
            i.completion_mode, i.expires_at
       from survey_invitations i
       join communication_contacts c on c.email_hash = i.recipient_hash
      where i.survey_id = $1
      order by i.created_at desc`,
    [surveyId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    respondentEmail: String(row.email),
    respondentName: typeof row.display_name === "string" ? row.display_name : null,
    openedAt: row.opened_at ? asIso(row.opened_at as Date) : null,
    completedAt: row.completed_at ? asIso(row.completed_at as Date) : null,
    completionMode:
      row.completion_mode === "anonymous" || row.completion_mode === "identified"
        ? row.completion_mode
        : null,
    expiresAt: asIso(row.expires_at as Date),
  }));
}
