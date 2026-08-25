import { createHash, randomUUID } from "node:crypto";

import { enqueueEmails } from "@/lib/platform/email-outbox.server";
import { query } from "@/lib/platform/postgres.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { getEvent } from "@/features/events/store.server";
import {
  renderCommunicationMessage,
  type CommunicationKind,
  type CommunicationMedia,
} from "./email.server";
import { prepareCommunicationLinkMap } from "./email-links.server";
import {
  optOutByToken as optOutMarketingByToken,
  setMarketingPreference as setMarketingConsentPreference,
} from "./marketing-consent.server";

export type CommunicationContact = {
  emailHash: string;
  email: string;
  displayName: string | null;
  sources: string[];
  marketingOptedIn: boolean;
  optedInAt: string | null;
  optedOutAt: string | null;
  marketingConsentSource: string | null;
  marketingConsentDecision: "granted" | "withdrawn" | null;
  marketingConsentAt: string | null;
  marketingConsentVersion: string | null;
  marketingConsentPrivacyVersion: string | null;
  unsubscribeToken: string;
};

export type CommunicationMessage = {
  id: string;
  kind: CommunicationKind;
  audience: string;
  eventSlug: string | null;
  subject: string;
  body: string;
  media: CommunicationMedia[];
  selectedContactHashes: string[];
  scheduledAt: string | null;
  status: string;
  recipientCount: number;
  queuedCount: number;
  lastError: string | null;
  createdAt: string;
  queuedAt: string | null;
  delivery: CommunicationDeliveryCounts;
  linkClicks: CommunicationLinkMetric[];
};

export type CommunicationDeliveryCounts = {
  queued: number;
  accepted: number;
  delivered: number;
  deferred: number;
  failed: number;
  bounced: number;
  rejected: number;
  complained: number;
  skipped: number;
};

export type CommunicationLinkMetric = {
  linkKey: string;
  uniqueRecipients: number;
  totalClicks: number;
};

type Candidate = { email: string; displayName: string | null; source: string };

function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

const EMPTY_DELIVERY_COUNTS: CommunicationDeliveryCounts = {
  queued: 0,
  accepted: 0,
  delivered: 0,
  deferred: 0,
  failed: 0,
  bounced: 0,
  rejected: 0,
  complained: 0,
  skipped: 0,
};

function deliveryCounts(value: unknown): CommunicationDeliveryCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_DELIVERY_COUNTS };
  }
  const row = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(EMPTY_DELIVERY_COUNTS).map((key) => [key, Number(row[key]) || 0]),
  ) as unknown as CommunicationDeliveryCounts;
}

function linkMetrics(value: unknown): CommunicationLinkMetric[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      linkKey: String(item.linkKey ?? ""),
      uniqueRecipients: Number(item.uniqueRecipients) || 0,
      totalClicks: Number(item.totalClicks) || 0,
    }))
    .filter((item) => item.linkKey);
}

function validMedia(value: unknown): CommunicationMedia[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      kind: (item.kind === "gif" || item.kind === "video"
        ? item.kind
        : "image") as CommunicationMedia["kind"],
      url: typeof item.url === "string" ? item.url.trim() : "",
      alt: typeof item.alt === "string" ? item.alt.trim().slice(0, 200) : "",
      ...(typeof item.posterUrl === "string" && item.posterUrl.trim()
        ? { posterUrl: item.posterUrl.trim() }
        : {}),
    }))
    .filter((item) => item.url.length > 0)
    .slice(0, 3);
}

async function syncContacts(): Promise<void> {
  const candidates = await query<Candidate>(`
    select lower(email) as email, nullif(trim(max(holder_name)), '') as display_name, 'event' as source
      from tickets
     where email is not null and trim(email) <> ''
     group by lower(email)
    union all
    select lower(owner_email) as email, nullif(trim(max(owner_name)), '') as display_name, 'pitch' as source
      from pitch_decks
     where owner_email is not null and trim(owner_email) <> ''
     group by lower(owner_email)
  `);
  const merged = new Map<string, Candidate & { sources: Set<string> }>();
  for (const candidate of candidates) {
    const email = candidate.email.trim().toLowerCase();
    if (!email) continue;
    candidate.displayName = candidate.displayName?.trim() || null;
    const key = hashEmail(email);
    const existing = merged.get(key);
    if (existing) {
      existing.sources.add(candidate.source);
      if (!existing.displayName && candidate.displayName)
        existing.displayName = candidate.displayName;
    } else {
      merged.set(key, {
        email,
        displayName: candidate.displayName,
        source: candidate.source,
        sources: new Set([candidate.source]),
      });
    }
  }
  for (const [emailHash, candidate] of merged) {
    await query(
      `insert into communication_contacts
         (email_hash, email, display_name, sources, unsubscribe_token)
       values ($1,$2,$3,$4,$5)
       on conflict (email_hash) do update
         set email = excluded.email,
             display_name = coalesce(
               nullif(trim(communication_contacts.display_name), ''),
               nullif(trim(excluded.display_name), '')
             ),
             sources = excluded.sources,
             updated_at = now()`,
      [emailHash, candidate.email, candidate.displayName, [...candidate.sources], randomUUID()],
    );
  }
}

function contactFromRow(row: Record<string, unknown>): CommunicationContact {
  return {
    emailHash: String(row.email_hash),
    email: String(row.email),
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    sources: Array.isArray(row.sources) ? row.sources.map(String) : [],
    marketingOptedIn: row.marketing_opted_in === true,
    optedInAt: iso(row.opted_in_at as Date | null),
    optedOutAt: iso(row.opted_out_at as Date | null),
    marketingConsentSource:
      typeof row.marketing_consent_source === "string" ? row.marketing_consent_source : null,
    marketingConsentDecision:
      row.marketing_consent_decision === "granted" || row.marketing_consent_decision === "withdrawn"
        ? row.marketing_consent_decision
        : null,
    marketingConsentAt: iso(row.marketing_consent_at as Date | null),
    marketingConsentVersion:
      typeof row.marketing_consent_version === "string" ? row.marketing_consent_version : null,
    marketingConsentPrivacyVersion:
      typeof row.marketing_consent_privacy_version === "string"
        ? row.marketing_consent_privacy_version
        : null,
    unsubscribeToken: String(row.unsubscribe_token),
  };
}

export async function listCommunicationContacts(): Promise<CommunicationContact[]> {
  await syncContacts();
  const rows = await query<
    Record<string, unknown>
  >(`select c.email_hash, c.email, c.display_name, c.sources, c.marketing_opted_in,
            c.opted_in_at, c.opted_out_at, c.unsubscribe_token,
            consent.source as marketing_consent_source,
            consent.decision as marketing_consent_decision,
            consent.occurred_at as marketing_consent_at,
            consent.consent_version as marketing_consent_version,
            consent.privacy_version as marketing_consent_privacy_version
       from communication_contacts c
       left join lateral (
         select source, decision, occurred_at, consent_version, privacy_version
           from communication_contact_consent_events
          where email_hash = c.email_hash
          order by occurred_at desc, created_at desc
          limit 1
       ) consent on true
      order by lower(coalesce(display_name, email)), email_hash`);
  return rows.map(contactFromRow);
}

export async function setMarketingPreference(emailHash: string, optedIn: boolean): Promise<void> {
  await setMarketingConsentPreference(emailHash, optedIn);
}

export async function optOutByToken(token: string): Promise<boolean> {
  return optOutMarketingByToken(token);
}

async function resolveRecipients(input: {
  kind: CommunicationKind;
  audience: string;
  eventSlug: string | null;
  selectedContactHashes: string[];
}): Promise<CommunicationContact[]> {
  await syncContacts();
  let hashes: string[] = [];
  if (input.audience === "marketing_opted_in" || input.audience === "selected") {
    hashes =
      input.audience === "selected"
        ? input.selectedContactHashes
        : (
            await query<{ email_hash: string }>(
              `select email_hash from communication_contacts where marketing_opted_in = true`,
            )
          ).map((row) => row.email_hash);
  } else if (input.audience === "event_attendees" && input.eventSlug) {
    const tickets = await query<{ email: string }>(
      `select distinct lower(email) as email
         from tickets
        where event_slug = $1 and status = 'valid' and email is not null`,
      [input.eventSlug],
    );
    hashes = tickets.map((ticket) => hashEmail(ticket.email));
  } else if (input.audience === "pitch_owners") {
    const pitches = await query<{ email: string }>(
      `select distinct d.owner_email_hash as email
         from pitch_decks d
         join communication_contacts c on c.email_hash = d.owner_email_hash
        where d.lifecycle = 'active'
          and d.published_at is null
          and c.marketing_opted_in = true`,
    );
    hashes = pitches.map((pitch) => pitch.email);
  }
  if (hashes.length === 0) return [];
  const rows = await query<Record<string, unknown>>(
    `select email_hash, email, display_name, sources, marketing_opted_in,
            opted_in_at, opted_out_at, unsubscribe_token
       from communication_contacts
      where email_hash = any($1::text[])`,
    [hashes],
  );
  const contacts = rows.map(contactFromRow);
  return input.audience === "selected" &&
    (input.kind === "newsletter" || input.kind === "pitch_nudge")
    ? contacts.filter((contact) => contact.marketingOptedIn)
    : contacts;
}

function messageFromRow(row: Record<string, unknown>): CommunicationMessage {
  return {
    id: String(row.id),
    kind: row.kind as CommunicationKind,
    audience: String(row.audience),
    eventSlug: typeof row.event_slug === "string" ? row.event_slug : null,
    subject: String(row.subject),
    body: String(row.body),
    media: validMedia(row.media),
    selectedContactHashes: Array.isArray(row.selected_contact_hashes)
      ? row.selected_contact_hashes.map(String)
      : [],
    scheduledAt: iso(row.scheduled_at as Date | null),
    status: String(row.status),
    recipientCount: Number(row.recipient_count),
    queuedCount: Number(row.queued_count),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    createdAt: iso(row.created_at as Date) ?? new Date().toISOString(),
    queuedAt: iso(row.queued_at as Date | null),
    delivery: deliveryCounts(row.delivery_counts),
    linkClicks: linkMetrics(row.link_clicks),
  };
}

export async function listCommunicationMessages(): Promise<CommunicationMessage[]> {
  const rows = await query<
    Record<string, unknown>
  >(`select id, kind, audience, event_slug, subject, body, media,
            selected_contact_hashes, scheduled_at, status, recipient_count,
            queued_count, last_error, created_at, queued_at,
            jsonb_build_object(
              'queued', (select count(*) from email_outbox o where o.communication_id = m.id and o.status in ('pending', 'processing')),
              'accepted', (select count(*) from email_outbox o where o.communication_id = m.id and o.status = 'accepted'),
              'delivered', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'delivered'),
              'deferred', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'deferred'),
              'failed', (select count(*) from email_outbox o where o.communication_id = m.id and o.status = 'failed'),
              'bounced', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'bounced'),
              'rejected', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'rejected'),
              'complained', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'complained')
            ) as delivery_counts,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'linkKey', clicks.link_key,
                'uniqueRecipients', clicks.unique_recipients,
                'totalClicks', clicks.total_clicks
              ) order by clicks.link_key)
                from (
                  select link_key,
                         count(*) filter (where click_count > 0) as unique_recipients,
                         coalesce(sum(click_count), 0) as total_clicks
                    from communication_links
                   where source_type = 'message' and source_id = m.id
                   group by link_key
                ) clicks
            ), '[]'::jsonb) as link_clicks
       from communication_messages m
      order by coalesce(scheduled_at, created_at) desc
      limit 100`);
  return rows.map(messageFromRow);
}

export async function listCommunicationEvents(): Promise<
  Array<{ slug: string; title: string; startsAt: string }>
> {
  const rows = await query<{ slug: string; title: string; starts_at: Date }>(
    `select slug, title, starts_at from events order by starts_at desc limit 100`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    startsAt: row.starts_at.toISOString(),
  }));
}

export async function saveCommunication(input: {
  kind: CommunicationKind;
  audience: string;
  eventSlug: string | null;
  subject: string;
  body: string;
  media: unknown;
  selectedContactHashes: string[];
  scheduledAt: string | null;
  request: Request;
}): Promise<CommunicationMessage> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || subject.length > 150) throw new Error("Give the message a subject");
  if (!body || body.length > 8000) throw new Error("Write the message first");
  if (["event_update", "event_service", "feedback"].includes(input.kind) && !input.eventSlug) {
    throw new Error("Choose an event for this message");
  }
  if (input.kind === "newsletter" && !["marketing_opted_in", "selected"].includes(input.audience)) {
    throw new Error("Newsletters can only use opted-in contacts");
  }
  const media = validMedia(input.media);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.scheduledAt && (!scheduledAt || Number.isNaN(scheduledAt.getTime()))) {
    throw new Error("Choose a valid send time");
  }
  const id = randomUUID();
  const isDraft = !scheduledAt;
  const recipients = isDraft
    ? []
    : await resolveRecipients({
        kind: input.kind,
        audience: input.audience,
        eventSlug: input.eventSlug,
        selectedContactHashes: input.selectedContactHashes,
      });
  if (!isDraft && recipients.length === 0) throw new Error("There are no people in this audience");

  await query(
    `insert into communication_messages
       (id, kind, audience, event_slug, subject, body, media,
        selected_contact_hashes, scheduled_at, status, recipient_count)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
    [
      id,
      input.kind,
      input.audience,
      input.eventSlug,
      subject,
      body,
      JSON.stringify(media),
      input.selectedContactHashes,
      scheduledAt,
      isDraft ? "draft" : "scheduled",
      recipients.length,
    ],
  );

  if (!isDraft) {
    const origin = getBaseUrlForRequest(input.request);
    const event = input.eventSlug ? ((await getEvent(input.eventSlug)) ?? undefined) : undefined;
    const queuedMessages = await Promise.all(
      recipients.map(async (recipient) => {
        const unsubscribeUrl =
          input.kind === "newsletter"
            ? new URL(`/api/marketing/unsubscribe/${recipient.unsubscribeToken}`, origin).toString()
            : undefined;
        const context = { event, recipientName: recipient.displayName ?? undefined };
        const trackingLinks = await prepareCommunicationLinkMap({
          body,
          context,
          origin,
          media,
          source: { sourceType: "message", sourceId: id, recipientHash: recipient.emailHash },
        });
        const rendered = renderCommunicationMessage({
          kind: input.kind,
          subject,
          body,
          media,
          recipientName: recipient.displayName ?? undefined,
          unsubscribeUrl,
          origin,
          meta: event?.title ?? input.eventSlug ?? undefined,
          context,
          trackingLinks,
        });
        return {
          idempotencyKey: `communications:${id}:${recipient.emailHash}`,
          kind: "communication" as const,
          source: scheduledAt ? ("scheduled" as const) : ("admin" as const),
          context: {
            eventSlug: input.eventSlug ?? undefined,
            communicationId: id,
          },
          message: {
            channel: "communications" as const,
            to: recipient.email,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
          },
          notBefore: scheduledAt ?? undefined,
          communicationId: id,
        };
      }),
    );
    await enqueueEmails(queuedMessages);
    await query(
      `update communication_messages
          set queued_count = $2, queued_at = now(), updated_at = now()
        where id = $1`,
      [id, recipients.length],
    );
  }

  const rows = await query<Record<string, unknown>>(
    `select id, kind, audience, event_slug, subject, body, media,
            selected_contact_hashes, scheduled_at, status, recipient_count,
            queued_count, last_error, created_at, queued_at,
            jsonb_build_object(
              'queued', (select count(*) from email_outbox o where o.communication_id = m.id and o.status in ('pending', 'processing')),
              'accepted', (select count(*) from email_outbox o where o.communication_id = m.id and o.status = 'accepted'),
              'delivered', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'delivered'),
              'deferred', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'deferred'),
              'failed', (select count(*) from email_outbox o where o.communication_id = m.id and o.status = 'failed'),
              'bounced', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'bounced'),
              'rejected', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'rejected'),
              'complained', (select count(*) from email_outbox o where o.communication_id = m.id and o.provider_delivery_status = 'complained')
            ) as delivery_counts,
            coalesce((
              select jsonb_agg(jsonb_build_object(
                'linkKey', clicks.link_key,
                'uniqueRecipients', clicks.unique_recipients,
                'totalClicks', clicks.total_clicks
              ) order by clicks.link_key)
                from (
                  select link_key,
                         count(*) filter (where click_count > 0) as unique_recipients,
                         coalesce(sum(click_count), 0) as total_clicks
                    from communication_links
                   where source_type = 'message' and source_id = m.id
                   group by link_key
                ) clicks
            ), '[]'::jsonb) as link_clicks
       from communication_messages m where m.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error("Communication was not saved");
  return messageFromRow(row);
}

export async function cancelCommunication(id: string): Promise<void> {
  await query(
    `update communication_messages
        set status = 'cancelled', updated_at = now()
      where id = $1 and status in ('draft', 'scheduled')`,
    [id],
  );
  await query(
    `update email_outbox
        set status = 'cancelled', cancelled_at = now(), message = null, updated_at = now()
      where communication_id = $1 and status = 'pending'`,
    [id],
  );
}
