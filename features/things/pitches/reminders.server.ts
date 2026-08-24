import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { getPitchOperationalStatus } from "./operational.server";
import {
  addPitchAccessTokens,
  createPitchOwnerToken,
  hashPitchValue,
  removePitchAccessTokens,
  recordPitchAudit,
} from "./store.server";
import { sendPitchReminderEmail } from "./email.server";
import type {
  PitchReminderAdminSnapshot,
  PitchReminderCandidate,
  PitchReminderHistoryItem,
  PitchReminderSettings,
  PitchReminderTemplate,
  PitchReminderWaveResult,
} from "./types";

const REMINDER_TEMPLATES: readonly PitchReminderTemplate[] = ["resume", "finish", "final"];

interface ReminderSettingsRow extends QueryResultRow {
  enabled: boolean;
  inactivity_days: number;
  gap_days: number;
  max_automatic: number;
  last_run_at: Date | string | null;
  updated_at: Date | string;
}

interface ReminderCandidateRow extends QueryResultRow {
  id: string;
  title: string;
  owner_name: string;
  owner_email: string;
  slide_count: string | number;
  updated_at: Date | string;
  automatic_count: string | number;
  last_sent_at: Date | string | null;
  due_at: Date | string;
}

interface ReminderHistoryRow extends QueryResultRow {
  id: string | number;
  title: string | null;
  owner_email: string | null;
  action: string;
  actor: string;
  metadata: unknown;
  created_at: Date | string;
}

function integer(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | null {
  return value ? iso(value) : null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseTemplate(value: unknown): PitchReminderTemplate | null {
  return typeof value === "string" && REMINDER_TEMPLATES.includes(value as PitchReminderTemplate)
    ? (value as PitchReminderTemplate)
    : null;
}

function settingsView(row: ReminderSettingsRow): PitchReminderSettings {
  return {
    enabled: row.enabled,
    inactivityDays: row.inactivity_days,
    gapDays: row.gap_days,
    maxAutomatic: row.max_automatic,
    lastRunAt: optionalIso(row.last_run_at),
    updatedAt: iso(row.updated_at),
  };
}

async function readSettings(): Promise<PitchReminderSettings> {
  const row = await queryOne<ReminderSettingsRow>(
    `select enabled, inactivity_days, gap_days, max_automatic, last_run_at, updated_at
       from pitch_reminder_settings
      where singleton = true`,
  );
  if (!row) throw new Error("Pitch reminder settings are unavailable");
  return settingsView(row);
}

async function readCandidateRows(
  settings: Pick<PitchReminderSettings, "inactivityDays" | "gapDays">,
  deckIds?: readonly string[],
): Promise<ReminderCandidateRow[]> {
  const values: unknown[] = [settings.inactivityDays, settings.gapDays];
  const filter = deckIds
    ? (() => {
        values.push(deckIds);
        return "and d.id = any($3::text[])";
      })()
    : "";
  return query<ReminderCandidateRow>(
    `select d.id, d.title, d.owner_name, d.owner_email,
            (
              select count(*)
                from jsonb_array_elements(d.draft_document->'slides') as slide
               where slide->>'deletedAt' is null
            )::text as slide_count,
            d.updated_at,
            coalesce(s.automatic_count, 0)::text as automatic_count,
            s.last_sent_at,
            greatest(
              d.updated_at + ($1::int * interval '1 day'),
              coalesce(
                s.last_sent_at + ($2::int * interval '1 day'),
                d.updated_at + ($1::int * interval '1 day')
              )
            ) as due_at
       from pitch_decks d
       left join pitch_reminder_state s on s.deck_id = d.id
      where d.lifecycle = 'active'
        and d.published_at is null
        and s.paused_at is null
        ${filter}
      order by due_at asc, d.updated_at asc, d.id
      limit 500`,
    values,
  );
}

function candidateView(
  row: ReminderCandidateRow,
  settings: PitchReminderSettings,
): PitchReminderCandidate {
  const automaticCount = integer(row.automatic_count);
  const automaticEligible =
    automaticCount < settings.maxAutomatic && new Date(row.due_at).getTime() <= Date.now();
  return {
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    slideCount: integer(row.slide_count),
    updatedAt: iso(row.updated_at),
    automaticCount,
    lastSentAt: optionalIso(row.last_sent_at),
    nextEligibleAt: iso(row.due_at),
    automaticEligible,
  };
}

async function readRecentHistory(): Promise<PitchReminderHistoryItem[]> {
  const rows = await query<ReminderHistoryRow>(
    `select e.id, d.title, d.owner_email, e.action, e.actor, e.metadata, e.created_at
       from pitch_audit_events e
       left join pitch_decks d on d.id = e.deck_id
      where e.action in ('email.reminder.queued', 'email.reminder.failed')
      order by e.created_at desc, e.id desc
      limit 24`,
  );
  return rows.map((row) => {
    const metadata = metadataRecord(row.metadata);
    return {
      id: String(row.id),
      title: row.title ?? "deleted pitch",
      ownerEmail: row.owner_email ?? "unknown recipient",
      action: row.action.endsWith("failed") ? "failed" : "queued",
      actor: row.actor,
      template: parseTemplate(metadata.template) ?? undefined,
      createdAt: iso(row.created_at),
    };
  });
}

export async function readPitchReminderAdmin(): Promise<PitchReminderAdminSnapshot> {
  const settings = await readSettings();
  const [rows, recent] = await Promise.all([readCandidateRows(settings), readRecentHistory()]);
  const candidates = rows.map((row) => candidateView(row, settings));
  const eligible = candidates.filter((candidate) => candidate.automaticEligible);
  return {
    settings,
    candidates,
    eligibleCount: eligible.length,
    nextEligibleAt: eligible[0]?.nextEligibleAt ?? null,
    recent,
  };
}

export async function updatePitchReminderSettings(input: {
  enabled: boolean;
  inactivityDays: number;
  gapDays: number;
  maxAutomatic: number;
}): Promise<PitchReminderAdminSnapshot> {
  if (
    !Number.isInteger(input.inactivityDays) ||
    input.inactivityDays < 1 ||
    input.inactivityDays > 90 ||
    !Number.isInteger(input.gapDays) ||
    input.gapDays < 1 ||
    input.gapDays > 90 ||
    !Number.isInteger(input.maxAutomatic) ||
    input.maxAutomatic < 1 ||
    input.maxAutomatic > 5
  ) {
    throw new Error("Choose valid reminder timing and limits");
  }
  await query(
    `update pitch_reminder_settings
        set enabled = $1,
            inactivity_days = $2,
            gap_days = $3,
            max_automatic = $4,
            updated_at = now()
      where singleton = true`,
    [input.enabled, input.inactivityDays, input.gapDays, input.maxAutomatic],
  );
  return readPitchReminderAdmin();
}

function automaticTemplate(automaticCount: number): PitchReminderTemplate {
  return automaticCount === 0 ? "resume" : automaticCount === 1 ? "finish" : "final";
}

function groupByEmail(candidates: readonly PitchReminderCandidate[]) {
  const groups = new Map<string, PitchReminderCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.ownerEmail) ?? [];
    group.push(candidate);
    groups.set(candidate.ownerEmail, group);
  }
  return groups.values();
}

async function updateReminderState(
  candidates: readonly PitchReminderCandidate[],
  template: PitchReminderTemplate,
  automatic: boolean,
): Promise<void> {
  await transaction(async (client) => {
    for (const candidate of candidates) {
      await client.query(
        `insert into pitch_reminder_state (
           deck_id, automatic_count, last_sent_at, last_template, updated_at
         ) values ($1, $2, now(), $3, now())
         on conflict (deck_id) do update set
           automatic_count = case
             when $4 then pitch_reminder_state.automatic_count + 1
             else pitch_reminder_state.automatic_count
           end,
           last_sent_at = now(),
           last_template = $3,
           updated_at = now()`,
        [
          candidate.id,
          automatic ? candidate.automaticCount + 1 : candidate.automaticCount,
          template,
          automatic,
        ],
      );
    }
  });
}

async function recordWaveAudit(
  candidates: readonly PitchReminderCandidate[],
  template: PitchReminderTemplate,
  actor: "admin" | "automatic",
  action: "queued" | "failed",
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await Promise.all(
    candidates.map((candidate) =>
      recordPitchAudit({
        deckId: candidate.id,
        action: `email.reminder.${action}`,
        actor,
        metadata: {
          template,
          slideCount: candidate.slideCount,
          ...metadata,
        },
      }).catch(() => undefined),
    ),
  );
}

export async function sendPitchReminderWave(input: {
  deckIds: readonly string[];
  template: PitchReminderTemplate | "automatic";
  origin: string;
  actor: "admin" | "automatic";
}): Promise<PitchReminderWaveResult> {
  const deckIds = [...new Set(input.deckIds)].slice(0, 500);
  if (deckIds.length === 0) {
    return {
      queuedEmails: 0,
      sentDecks: 0,
      failedDecks: 0,
      automatic: input.actor === "automatic",
    };
  }
  const settings = await readSettings();
  const candidates = (await readCandidateRows(settings, deckIds)).map((row) =>
    candidateView(row, settings),
  );
  const selected =
    input.actor === "automatic"
      ? candidates.filter((candidate) => candidate.automaticEligible)
      : candidates;
  const waveId = randomUUID();
  let queuedEmails = 0;
  let sentDecks = 0;
  let failedDecks = 0;

  for (const group of groupByEmail(selected)) {
    const template =
      input.template === "automatic"
        ? automaticTemplate(Math.max(...group.map((candidate) => candidate.automaticCount)))
        : input.template;
    const tokens = group.map((candidate) => ({
      candidate,
      token: createPitchOwnerToken(),
    }));
    const idempotencyKey =
      input.actor === "automatic"
        ? `pitches:reminder:${group
            .map((candidate) => `${candidate.id}:${candidate.automaticCount + 1}`)
            .sort()
            .join(",")}:${template}`
        : `pitches:reminder:manual:${waveId}:${hashPitchValue(group[0]!.ownerEmail)}`;
    try {
      await addPitchAccessTokens(
        tokens.map(({ candidate, token }) => ({
          deckId: candidate.id,
          token,
          label: "reminder",
          actor: input.actor,
        })),
      );
      const delivery = await sendPitchReminderEmail({
        email: group[0]!.ownerEmail,
        origin: input.origin,
        ownerName: group[0]!.ownerName,
        template,
        decks: tokens.map(({ candidate, token }) => ({
          id: candidate.id,
          title: candidate.title,
          slideCount: candidate.slideCount,
          token,
        })),
        idempotencyKey,
      });
      if (!delivery.ok) {
        await removePitchAccessTokens(tokens.map(({ token }) => token));
        failedDecks += group.length;
        await recordWaveAudit(group, template, input.actor, "failed", {
          status: delivery.status,
          error: delivery.error,
        });
        continue;
      }
      await updateReminderState(group, template, input.actor === "automatic");
      await recordWaveAudit(group, template, input.actor, "queued", {
        messageId: delivery.id,
      });
      queuedEmails += 1;
      sentDecks += group.length;
    } catch (error) {
      await removePitchAccessTokens(tokens.map(({ token }) => token)).catch(() => undefined);
      failedDecks += group.length;
      await recordWaveAudit(group, template, input.actor, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (input.actor === "automatic") {
    await query(
      `update pitch_reminder_settings
          set last_run_at = now(), updated_at = now()
        where singleton = true`,
    );
  }
  return { queuedEmails, sentDecks, failedDecks, automatic: input.actor === "automatic" };
}

export async function runAutomaticPitchReminders(input: {
  origin: string;
}): Promise<PitchReminderWaveResult> {
  const operationalStatus = await getPitchOperationalStatus();
  if (!operationalStatus.canWrite) {
    return { queuedEmails: 0, sentDecks: 0, failedDecks: 0, automatic: true };
  }
  const snapshot = await readPitchReminderAdmin();
  if (!snapshot.settings.enabled) {
    await query(
      `update pitch_reminder_settings
          set last_run_at = now(), updated_at = now()
        where singleton = true`,
    );
    return { queuedEmails: 0, sentDecks: 0, failedDecks: 0, automatic: true };
  }
  return sendPitchReminderWave({
    deckIds: snapshot.candidates
      .filter((candidate) => candidate.automaticEligible)
      .map((candidate) => candidate.id),
    template: "automatic",
    origin: input.origin,
    actor: "automatic",
  });
}
