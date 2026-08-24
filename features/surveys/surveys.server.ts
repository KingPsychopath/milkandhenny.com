import { createHash, randomUUID } from "node:crypto";

import { query } from "@/lib/platform/postgres.server";
import {
  SURVEY_QUESTION_TYPES,
  type SurveyQuestion,
  type SurveyRecord,
  type SurveyResponse,
  type SurveyQuestionType,
} from "./types";

export { SURVEY_QUESTION_TYPES } from "./types";
export type { SurveyQuestion, SurveyRecord, SurveyResponse, SurveyQuestionType } from "./types";

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
        hint: typeof item.hint === "string" && item.hint.trim() ? item.hint.trim().slice(0, 400) : undefined,
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
    status: row.status as SurveyRecord["status"],
    responseCount: Number(row.response_count) || 0,
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

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export async function listSurveys(): Promise<SurveyRecord[]> {
  const rows = await query<Record<string, unknown>>(`
    select id, slug, event_slug, title, intro, questions, status, response_count,
           created_at, updated_at
      from surveys
     where status <> 'archived'
     order by updated_at desc
  `);
  return rows.map(fromRow);
}

export async function getSurvey(slug: string, includeDraft = false): Promise<SurveyRecord | null> {
  const rows = await query<Record<string, unknown>>(
    `select id, slug, event_slug, title, intro, questions, status, response_count,
            created_at, updated_at
       from surveys
      where slug = $1
        and ($2 or status in ('open', 'closed'))
      limit 1`,
    [normaliseSlug(slug), includeDraft],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function saveSurvey(input: {
  id?: string;
  slug: string;
  eventSlug?: string | null;
  title: string;
  intro: string;
  questions: unknown;
  status: SurveyRecord["status"];
}): Promise<SurveyRecord> {
  const slug = normaliseSlug(input.slug);
  const title = input.title.trim().slice(0, 160);
  const intro = input.intro.trim().slice(0, 2000);
  const questions = asQuestions(input.questions);
  if (!slug || !title || questions.length === 0) throw new Error("Add a title and at least one question");
  if (input.status === "open" && questions.some((question) => !question.label)) {
    throw new Error("Every question needs a label");
  }
  const id = input.id || randomUUID();
  await query(
    `insert into surveys (id, slug, event_slug, title, intro, questions, status)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7)
     on conflict (id) do update set
       slug = excluded.slug,
       event_slug = excluded.event_slug,
       title = excluded.title,
       intro = excluded.intro,
       questions = excluded.questions,
       status = excluded.status,
       updated_at = now()`,
    [id, slug, input.eventSlug || null, title, intro, JSON.stringify(questions), input.status],
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
  if (question.type === "rating" && (!/^[1-5]$/.test(answer) || Number(answer) < 1 || Number(answer) > 5)) return null;
  if (question.type === "yes_no" && answer !== "yes" && answer !== "no") return null;
  if (question.type === "single_choice" && !(question.options ?? []).includes(answer)) return null;
  if (question.type === "email" && !validEmail(answer)) return null;
  return answer;
}

export async function submitSurvey(input: {
  slug: string;
  respondentName?: string;
  respondentEmail?: string;
  answers: Record<string, unknown>;
}): Promise<{ accepted: true; alreadySubmitted: boolean }> {
  const survey = await getSurvey(input.slug);
  if (!survey || survey.status !== "open") throw new Error("This survey is not open");
  const answers: Record<string, string | string[]> = {};
  for (const question of survey.questions) {
    const answer = cleanAnswer(question, input.answers[question.id]);
    if (question.required && answer === null) throw new Error(`Answer “${question.label}” to continue`);
    if (answer !== null) answers[question.id] = answer;
  }
  const email = input.respondentEmail?.trim().toLowerCase() || null;
  if (email && !validEmail(email)) throw new Error("Enter a valid email address");
  const emailHash = email ? hashEmail(email) : null;
  const rows = await query<{ inserted: boolean }>(
    `with inserted as (
       insert into survey_responses
         (id, survey_id, respondent_email, email_hash, respondent_name, answers)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (survey_id, email_hash) where email_hash is not null do nothing
       returning id
     )
     select exists(select 1 from inserted) as inserted`,
    [randomUUID(), survey.id, email, emailHash, input.respondentName?.trim().slice(0, 160) || null, JSON.stringify(answers)],
  );
  const inserted = Boolean(rows[0]?.inserted);
  if (inserted) {
    await query(`update surveys set response_count = response_count + 1, updated_at = now() where id = $1`, [survey.id]);
  }
  return { accepted: true, alreadySubmitted: !inserted && Boolean(emailHash) };
}

export async function listSurveyResponses(surveyId: string): Promise<SurveyResponse[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, respondent_email, respondent_name, answers, submitted_at
       from survey_responses
      where survey_id = $1
      order by submitted_at desc`,
    [surveyId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    respondentEmail: typeof row.respondent_email === "string" ? row.respondent_email : null,
    respondentName: typeof row.respondent_name === "string" ? row.respondent_name : null,
    answers: (row.answers && typeof row.answers === "object" ? row.answers : {}) as Record<string, string | string[]>,
    submittedAt: asIso(row.submitted_at as Date),
  }));
}
