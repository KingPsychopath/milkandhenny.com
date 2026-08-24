import { createHash, randomUUID } from "node:crypto";

import { enqueueEmail } from "@/lib/platform/email-outbox.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { BASE_URL, getBaseUrlForRequest } from "@/lib/shared/config";
import { buildAppUrl } from "@/lib/shared/app-url";
import { getEvent } from "@/features/events/store.server";
import { listTicketsForEvent } from "@/features/tickets/store.server";
import { renderCommunicationMessage, type CommunicationEmailContext, type CommunicationKind, type CommunicationMedia } from "./email.server";
import { listCommunicationContacts } from "./communications.server";

export type CommunicationPlanStage = {
  id: string;
  stageKey: string;
  label: string;
  position: number;
  kind: CommunicationKind;
  audience: "event_attendees" | "marketing_opted_in" | "selected";
  subject: string;
  body: string;
  media: CommunicationMedia[];
  sendAt: string | null;
  lateJoinHours: number;
  status: string;
  recipientCount: number;
  queuedCount: number;
  surveyId: string | null;
};

export type CommunicationPlan = {
  id: string;
  eventSlug: string;
  eventTitle: string;
  name: string;
  status: string;
  stages: CommunicationPlanStage[];
  createdAt: string;
  updatedAt: string;
};

export type CommunicationTemplate = {
  id: string;
  name: string;
  kind: CommunicationKind;
  subject: string;
  body: string;
  media: CommunicationMedia[];
  isDefault: boolean;
  archivedAt: string | null;
  updatedAt: string;
};

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function validMedia(value: unknown): CommunicationMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      kind: (item.kind === "gif" || item.kind === "video" ? item.kind : "image") as CommunicationMedia["kind"],
      url: typeof item.url === "string" ? item.url.trim() : "",
      alt: typeof item.alt === "string" ? item.alt.trim().slice(0, 200) : "",
      ...(typeof item.posterUrl === "string" && item.posterUrl.trim() ? { posterUrl: item.posterUrl.trim() } : {}),
    }))
    .filter((item) => item.url)
    .slice(0, 3);
}

function fromStage(row: Record<string, unknown>): CommunicationPlanStage {
  return {
    id: String(row.id),
    stageKey: String(row.stage_key),
    label: String(row.label),
    position: Number(row.position) || 0,
    kind: row.kind as CommunicationKind,
    audience: row.audience as CommunicationPlanStage["audience"],
    subject: String(row.subject),
    body: String(row.body),
    media: validMedia(row.media),
    sendAt: iso(row.send_at as Date | null),
    lateJoinHours: Number(row.late_join_hours) || 0,
    status: String(row.status),
    recipientCount: Number(row.recipient_count) || 0,
    queuedCount: Number(row.queued_count) || 0,
    surveyId: typeof row.survey_id === "string" ? row.survey_id : null,
  };
}

async function rowsForPlans(where = "", values: unknown[] = []): Promise<CommunicationPlan[]> {
  const rows = await query<Record<string, unknown>>(
    `select p.id, p.event_slug, p.name, p.status, p.created_at, p.updated_at,
            e.title as event_title,
            coalesce(jsonb_agg(jsonb_build_object(
              'id', s.id,
              'stage_key', s.stage_key,
              'label', s.label,
              'position', s.position,
              'kind', s.kind,
              'audience', s.audience,
              'subject', s.subject,
              'body', s.body,
              'media', s.media,
              'send_at', s.send_at,
              'late_join_hours', s.late_join_hours,
              'status', s.status,
              'recipient_count', s.recipient_count,
              'queued_count', s.queued_count,
              'survey_id', s.survey_id
            ) order by s.position) filter (where s.id is not null), '[]'::jsonb) as stages
       from communication_plans p
       join events e on e.slug = p.event_slug
       left join communication_plan_stages s on s.plan_id = p.id
      ${where}
      group by p.id, e.title
      order by p.updated_at desc`,
    values,
  );
  return rows.map((row) => ({
    id: String(row.id),
    eventSlug: String(row.event_slug),
    eventTitle: String(row.event_title),
    name: String(row.name),
    status: String(row.status),
    stages: Array.isArray(row.stages) ? row.stages.map((stage) => fromStage(stage as Record<string, unknown>)) : [],
    createdAt: new Date(row.created_at as Date).toISOString(),
    updatedAt: new Date(row.updated_at as Date).toISOString(),
  }));
}

export async function listCommunicationPlans(eventSlug?: string): Promise<CommunicationPlan[]> {
  return eventSlug
    ? rowsForPlans("where p.event_slug = $1", [eventSlug])
    : rowsForPlans();
}

export async function listCommunicationTemplates(): Promise<CommunicationTemplate[]> {
  const rows = await query<Record<string, unknown>>(`
    select id, name, kind, subject, body, media, is_default, archived_at, updated_at
      from communication_templates
     where archived_at is null
     order by is_default desc, updated_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as CommunicationKind,
    subject: String(row.subject),
    body: String(row.body),
    media: validMedia(row.media),
    isDefault: row.is_default === true,
    archivedAt: iso(row.archived_at as Date | null),
    updatedAt: new Date(row.updated_at as Date).toISOString(),
  }));
}

export async function saveCommunicationTemplate(input: {
  id?: string;
  name: string;
  kind: CommunicationKind;
  subject: string;
  body: string;
  media: unknown;
  isDefault: boolean;
}): Promise<CommunicationTemplate> {
  const name = input.name.trim().slice(0, 120);
  const subject = input.subject.trim().slice(0, 150);
  const body = input.body.trim().slice(0, 8000);
  if (!name || !subject || !body) throw new Error("Add a template name, subject, and message");
  const id = input.id || randomUUID();
  if (input.isDefault) await query(`update communication_templates set is_default = false, updated_at = now() where kind = $1`, [input.kind]);
  await query(
    `insert into communication_templates (id, name, kind, subject, body, media, is_default)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7)
     on conflict (id) do update set
       name = excluded.name, kind = excluded.kind, subject = excluded.subject,
       body = excluded.body, media = excluded.media, is_default = excluded.is_default,
       archived_at = null, updated_at = now()`,
    [id, name, input.kind, subject, body, JSON.stringify(validMedia(input.media)), input.isDefault],
  );
  const rows = await query<Record<string, unknown>>(`select id, name, kind, subject, body, media, is_default, archived_at, updated_at from communication_templates where id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new Error("Template was not saved");
  return {
    id: String(row.id), name: String(row.name), kind: row.kind as CommunicationKind,
    subject: String(row.subject), body: String(row.body), media: validMedia(row.media),
    isDefault: row.is_default === true, archivedAt: iso(row.archived_at as Date | null), updatedAt: new Date(row.updated_at as Date).toISOString(),
  };
}

export async function archiveCommunicationTemplate(id: string): Promise<void> {
  await query(`update communication_templates set archived_at = now(), is_default = false, updated_at = now() where id = $1`, [id]);
}

function localDateAt(event: { startsAt: string; timezone: string }, daysFromStart: number, hour: number): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: event.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(event.startsAt));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const candidate = new Date(Date.UTC(get("year"), get("month") - 1, get("day") + daysFromStart, hour, 0));
  const offsetParts = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone, timeZoneName: "longOffset" }).formatToParts(candidate);
  const offset = offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(offset);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3] ?? 0)) * (match[1] === "-" ? -1 : 1) : 0;
  return new Date(candidate.getTime() - offsetMinutes * 60_000);
}

function eventStartLocal(event: { startsAt: string; timezone: string }, hoursBefore: number): Date {
  return new Date(new Date(event.startsAt).getTime() - hoursBefore * 60 * 60_000);
}

async function ensureSurvey(eventSlug: string, eventTitle: string): Promise<string> {
  const slug = eventSlug === "after-school-club-2026-09-01" ? "after-school-club-feedback" : `${eventSlug}-feedback`.slice(0, 80);
  const existing = await query<{ id: string }>(`select id from surveys where slug = $1 limit 1`, [slug]);
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  await query(
    `insert into surveys (id, slug, event_slug, title, intro, questions, status)
     values ($1,$2,$3,$4,$5,$6::jsonb,'open')`,
    [
      id,
      slug,
      eventSlug,
      `Tell us about ${eventTitle}`,
      "A few honest answers help us make the next one better. There are no wrong answers.",
      JSON.stringify([
        { id: "overall", type: "rating", label: "How was the overall feeling?", hint: "1 is not for you; 5 is more please.", required: true },
        { id: "worked", type: "long_text", label: "What worked?", hint: "A moment, a detail, a person, a game — anything.", required: true },
        { id: "change", type: "long_text", label: "What should we change next time?", required: false },
        { id: "return", type: "yes_no", label: "Would you come again?", required: true },
      ]),
    ],
  );
  return id;
}

export async function createStarterPlan(eventSlug: string): Promise<CommunicationPlan> {
  const event = await getEvent(eventSlug);
  if (!event) throw new Error("Event not found");
  const existing = await listCommunicationPlans(eventSlug);
  if (existing[0]) return existing[0];
  const surveyId = await ensureSurvey(eventSlug, event.title);
  const planId = randomUUID();
  const isCurrentAfterSchool = eventSlug === "after-school-club-2026-09-01";
  const prepAt = isCurrentAfterSchool ? new Date("2026-08-24T09:00:00.000Z") : localDateAt(event, -7, 10);
  const practicalAt = localDateAt(event, -2, 10);
  const dayOfAt = event.doorsAt ? eventStartLocal({ startsAt: event.doorsAt, timezone: event.timezone }, 4) : eventStartLocal(event, 4);
  const thankYouAt = localDateAt(event, 1, 10);
  const surveyReminderAt = localDateAt(event, 4, 10);
  const gif = `${BASE_URL}/media/after-school-club-walking.gif`;
  const poster = `${BASE_URL}/media/after-school-club-walking-poster.jpg`;
  const stages = [
    {
      stageKey: "prepare",
      label: "Optional preparation",
      position: 0,
      kind: "event_service" as const,
      subject: "A little After School Club preparation",
      body: "You’re coming to **{{event.title}}** next Tuesday.\n\nNo preparation is required, but if you fancy it, you can:\n\n- [Practise your spelling]({{links.spellingGame}}) with the Milk & Henny spelling game.\n- [Create a short pitch]({{links.pitch}}) about an idea, opinion, product, or theory.\n\nYou do not have to present it. It can simply be something silly or interesting that you make for yourself.\n\nSee you soon,\nMilk & Henny",
      media: [],
      sendAt: prepAt,
      lateJoinHours: 192,
      surveyId: null,
    },
    {
      stageKey: "getting-there",
      label: "Getting there",
      position: 1,
      kind: "event_service" as const,
      subject: "Getting to After School Club",
      body: "Here is the practical bit for **{{event.title}}**.\n\n**{{event.venue}}**\n{{event.address}}\n\nFrom Woolwich Dockyard Station — 12-minute walk\nFrom Charlton Station — 20-minute walk\nFrom Woolwich Arsenal — 26-minute walk\n\nWhen you reach the roundabout near McDonald’s, follow the signs for Thames Side Studios. You will be there in minutes.\n\nFree parking is available. Follow the milk & henny signs when you arrive.\n\nDoors: **{{event.doors}}**\nStarts: **{{event.time}}**\n\n[Watch the video version]({{links.walkingVideo}}).\n\nIf you get stuck, email [hello@milkandhenny.com]({{links.email}}).",
      media: [{ kind: "gif", url: gif, alt: "A short walking guide arriving at Common Sense Studios", posterUrl: poster }],
      sendAt: practicalAt,
      lateJoinHours: 72,
      surveyId: null,
    },
    {
      stageKey: "today",
      label: "Today",
      position: 2,
      kind: "event_service" as const,
      subject: "Today: After School Club",
      body: "Today’s the day.\n\n**{{event.title}}**\n{{event.venue}}\n{{event.address}}\n\nDoors: **{{event.doors}}**\nStarts: **{{event.time}}**\n\nFree parking is available. Follow the milk & henny signs. Keep your ticket email handy. A screenshot is fine.\n\nSee you soon.",
      media: [],
      sendAt: dayOfAt,
      lateJoinHours: 24,
      surveyId: null,
    },
    {
      stageKey: "thank-you",
      label: "Thank you and feedback",
      position: 3,
      kind: "feedback" as const,
      subject: "Thank you for coming to After School Club",
      body: "Thank you for coming to **{{event.title}}**.\n\nWe would love to hear what you thought. It should take about two minutes:\n\n[Share your thoughts]({{survey.url}})\n\nWhat worked? What should we change? Would you come again?\n\nThank you for being there.",
      media: [],
      sendAt: thankYouAt,
      lateJoinHours: 48,
      surveyId,
    },
    {
      stageKey: "survey-reminder",
      label: "Survey reminder",
      position: 4,
      kind: "feedback" as const,
      subject: "One last question about After School Club",
      body: "If you have two minutes, we would still love your feedback:\n\n[Share your thoughts]({{survey.url}})\n\nThank you for being there.",
      media: [],
      sendAt: surveyReminderAt,
      lateJoinHours: 24,
      surveyId,
    },
  ];

  await query(`insert into communication_plans (id, event_slug, name) values ($1,$2,$3)`, [planId, eventSlug, `${event.title} · event plan`]);
  for (const stage of stages) {
    const templateId = randomUUID();
    await query(
      `insert into communication_templates (id, name, kind, subject, body, media, is_default)
       values ($1,$2,$3,$4,$5,$6::jsonb,false)`,
      [templateId, `${event.title} · ${stage.label}`, stage.kind, stage.subject, stage.body, JSON.stringify(stage.media)],
    );
    await query(
      `insert into communication_plan_stages
         (id, plan_id, stage_key, label, position, kind, audience, subject, body, media,
          template_id, survey_id, send_at, late_join_hours)
       values ($1,$2,$3,$4,$5,$6,'event_attendees',$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [randomUUID(), planId, stage.stageKey, stage.label, stage.position, stage.kind, stage.subject, stage.body, JSON.stringify(stage.media), templateId, stage.surveyId, stage.sendAt, stage.lateJoinHours],
    );
  }
  const created = await listCommunicationPlans(eventSlug);
  if (!created[0]) throw new Error("Event plan was not saved");
  return created[0];
}

export async function updateCommunicationPlanStage(input: {
  id: string;
  subject: string;
  body: string;
  media: unknown;
  sendAt: string | null;
}): Promise<void> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  const sendAt = input.sendAt ? new Date(input.sendAt) : null;
  if (!subject || !body || (input.sendAt && (!sendAt || Number.isNaN(sendAt.getTime())))) throw new Error("Add a subject, message, and valid send time");
  await query(
    `update communication_plan_stages
        set subject = $2, body = $3, media = $4::jsonb, send_at = $5,
            status = case when status in ('draft', 'scheduled') then 'draft' else status end,
            updated_at = now()
      where id = $1`,
    [input.id, subject, body, JSON.stringify(validMedia(input.media)), sendAt],
  );
}

export async function scheduleCommunicationPlan(planId: string): Promise<void> {
  await query(
    `update communication_plans set status = 'scheduled', updated_at = now() where id = $1 and status in ('draft', 'paused')`,
    [planId],
  );
  await query(
    `update communication_plan_stages
        set status = 'scheduled', updated_at = now()
      where plan_id = $1 and status = 'draft' and send_at is not null`,
    [planId],
  );
}

export async function pauseCommunicationPlan(planId: string): Promise<void> {
  await query(`update communication_plans set status = 'paused', updated_at = now() where id = $1 and status = 'scheduled'`, [planId]);
  await query(`update communication_plan_stages set status = 'paused', updated_at = now() where plan_id = $1 and status = 'scheduled'`, [planId]);
}

export async function sendCommunicationStageNow(stageId: string, request?: Request): Promise<number> {
  const rows = await query<{ plan_id: string; event_slug: string }>(
    `select s.plan_id, p.event_slug
       from communication_plan_stages s
       join communication_plans p on p.id = s.plan_id
      where s.id = $1`,
    [stageId],
  );
  const stage = rows[0];
  if (!stage) throw new Error("Stage not found");
  await query(`update communication_plans set status = 'scheduled', updated_at = now() where id = $1 and status in ('draft', 'paused')`, [stage.plan_id]);
  await query(`update communication_plan_stages set send_at = now(), status = 'scheduled', updated_at = now() where id = $1 and status in ('draft', 'scheduled', 'paused')`, [stageId]);
  return expandDueCommunicationStages(request);
}

type StageRecipient = { email: string; displayName: string | null; emailHash: string };

async function recipientsForStage(stage: CommunicationPlanStage, eventSlug: string): Promise<StageRecipient[]> {
  if (stage.audience !== "event_attendees") return [];
  const tickets = await listTicketsForEvent(eventSlug);
  const recipients = new Map<string, StageRecipient>();
  for (const ticket of tickets) {
    if (ticket.status !== "valid" || !ticket.email) continue;
    const email = ticket.email.trim().toLowerCase();
    const emailHash = hashEmail(email);
    if (!recipients.has(emailHash)) recipients.set(emailHash, { email, emailHash, displayName: ticket.holderName || null });
  }
  return [...recipients.values()];
}

export async function previewCommunicationStage(stageId: string): Promise<{ recipientCount: number; recipients: Array<{ name: string | null; email: string }> }> {
  const rows = await query<{ plan_id: string; event_slug: string }>(
    `select s.plan_id, p.event_slug
       from communication_plan_stages s
       join communication_plans p on p.id = s.plan_id
      where s.id = $1`,
    [stageId],
  );
  const stage = rows[0];
  if (!stage) throw new Error("Stage not found");
  const plans = await listCommunicationPlans(stage.event_slug);
  const plan = plans.find((candidate) => candidate.id === stage.plan_id);
  const selected = plan?.stages.find((candidate) => candidate.id === stageId);
  if (!selected) throw new Error("Stage not found");
  const recipients = await recipientsForStage(selected, stage.event_slug);
  return { recipientCount: recipients.length, recipients: recipients.map((recipient) => ({ name: recipient.displayName, email: recipient.email })) };
}

async function claimDueStages(): Promise<Array<{ stageId: string; planId: string; eventSlug: string }>> {
  return transaction(async (client) => {
    await client.query(
      `update communication_plan_stages
          set status = 'complete', last_error = 'send window passed', updated_at = now()
        where status = 'scheduled'
          and send_at < now()
          and send_at + (late_join_hours * interval '1 hour') < now()`,
    );
    const result = await client.query<{ stage_id: string; plan_id: string; event_slug: string }>(
      `with due as (
         select s.id
           from communication_plan_stages s
           join communication_plans p on p.id = s.plan_id
          where p.status = 'scheduled'
            and s.status = 'scheduled'
            and s.send_at <= now()
            and s.send_at + (s.late_join_hours * interval '1 hour') >= now()
          order by s.send_at, s.position
          for update of s skip locked
          limit 3
       )
       update communication_plan_stages s
          set status = 'fanout', updated_at = now()
         from due, communication_plans p
        where s.id = due.id and p.id = s.plan_id
       returning s.id as stage_id, s.plan_id, p.event_slug`,
    );
    return result.rows.map((row) => ({ stageId: row.stage_id, planId: row.plan_id, eventSlug: row.event_slug }));
  });
}

export async function expandDueCommunicationStages(request?: Request): Promise<number> {
  const due = await claimDueStages();
  let queued = 0;
  await listCommunicationContacts();
  for (const item of due) {
    const plans = await listCommunicationPlans(item.eventSlug);
    const plan = plans.find((candidate) => candidate.id === item.planId);
    const stage = plan?.stages.find((candidate) => candidate.id === item.stageId);
    const event = await getEvent(item.eventSlug);
    if (!plan || !stage || !event) continue;
    const recipients = await recipientsForStage(stage, item.eventSlug);
    const surveyRow = stage.surveyId ? await query<{ slug: string }>(`select slug from surveys where id = $1`, [stage.surveyId]) : [];
    const origin = request ? getBaseUrlForRequest(request) : BASE_URL;
    const surveyUrl = surveyRow[0] ? buildAppUrl(origin, `/surveys/${surveyRow[0].slug}`) : undefined;
    let recipientCount = 0;
    let stageQueued = 0;
    for (const recipient of recipients) {
      const inserted = await query<{ email_hash: string }>(
        `insert into communication_stage_deliveries (stage_id, email_hash, email)
         values ($1,$2,$3)
         on conflict (stage_id, email_hash) do nothing
         returning email_hash`,
        [stage.id, recipient.emailHash, recipient.email],
      );
      if (!inserted[0]) continue;
      recipientCount += 1;
      const context: CommunicationEmailContext = { event, surveyUrl, recipientName: recipient.displayName ?? undefined };
      const rendered = renderCommunicationMessage({
        kind: stage.kind,
        subject: stage.subject,
        body: stage.body,
        media: stage.media,
        recipientName: recipient.displayName ?? undefined,
        origin,
        meta: event.title,
        context,
      });
      const result = await enqueueEmail(
        { channel: "communications", to: recipient.email, subject: rendered.subject, text: rendered.text, html: rendered.html },
        { idempotencyKey: `communication-stage:${stage.id}:${recipient.emailHash}`, communicationId: stage.id },
      );
      if (result.ok) {
        queued += 1;
        stageQueued += 1;
        await query(`update communication_stage_deliveries set status = 'queued', updated_at = now() where stage_id = $1 and email_hash = $2`, [stage.id, recipient.emailHash]);
      } else {
        await query(`update communication_stage_deliveries set status = 'failed', updated_at = now() where stage_id = $1 and email_hash = $2`, [stage.id, recipient.emailHash]);
      }
    }
    await query(
      `update communication_plan_stages
          set status = 'queued', recipient_count = $2, queued_count = $3, queued_at = now(), updated_at = now()
        where id = $1`,
      [stage.id, recipientCount, stageQueued],
    );
  }
  return queued;
}
