import { randomUUID } from "node:crypto";

import { sendEmail } from "@/lib/platform/email.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { actionEmailHash, maskActionEmail } from "./action-links.server";
import { resolveAdminNotificationDeepLink } from "./notification-destination";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";

export type DomainEventSeverity = "info" | "prompt" | "warning" | "critical";

export type DomainEventInput = {
  kind: string;
  deduplicationKey: string;
  actorType: string;
  actorId?: string;
  eventSlug?: string;
  entityRefs: Record<string, unknown>;
  severity?: DomainEventSeverity;
  correlationId?: string;
  payload?: Record<string, unknown>;
  admin?: {
    title: string;
    body: string;
    deepLink?: string;
    category?: string;
    createCase?: boolean;
  };
};

export type AdminInboxItem = {
  id: string;
  caseId?: string;
  title: string;
  body: string;
  eventSlug?: string;
  category: string;
  severity: DomainEventSeverity;
  assigneePersonId?: string;
  assigneeName?: string;
  privateNote?: { body?: string; actorId?: string; updatedAt?: string };
  resolutionReason?: string;
  deepLink: string;
  status: "new" | "in-progress" | "resolved" | "dismissed";
  unread: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminNotificationViewer = {
  actorId: string;
  actorType: "root-owner" | "admin";
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export async function emitDomainEvent(
  input: DomainEventInput,
): Promise<{ id: string; created: boolean }> {
  const severity = input.severity ?? "info";
  const correlationId = input.correlationId ?? randomUUID();
  const adminDeepLink = input.admin
    ? resolveAdminNotificationDeepLink({
        kind: input.kind,
        category: input.admin.category ?? input.kind,
        eventSlug: input.eventSlug,
        entityRefs: input.entityRefs,
        fallback: input.admin.deepLink,
      })
    : undefined;
  const result = await transaction(async (client) => {
    const eventId = id("event");
    const inserted = await client.query<{ id: string }>(
      `insert into attendee_domain_events
         (id,kind,deduplication_key,actor_type,actor_id,event_slug,entity_refs,severity,correlation_id,payload)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb)
       on conflict (deduplication_key) do nothing returning id`,
      [
        eventId,
        input.kind,
        input.deduplicationKey,
        input.actorType,
        input.actorId ?? null,
        input.eventSlug ?? null,
        JSON.stringify(input.entityRefs),
        severity,
        correlationId,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    if (!inserted.rows[0]) {
      const existing = await client.query<{ id: string }>(
        `select id from attendee_domain_events where deduplication_key = $1`,
        [input.deduplicationKey],
      );
      return { id: existing.rows[0]?.id ?? eventId, created: false };
    }
    let caseId: string | null = null;
    if (input.admin?.createCase && severity !== "info") {
      caseId = id("case");
      await client.query(
        `insert into admin_attention_cases
           (id,category,severity,event_slug,related_entities,source_event_id)
         values ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          caseId,
          input.admin.category ?? input.kind,
          severity,
          input.eventSlug ?? null,
          JSON.stringify(input.entityRefs),
          eventId,
        ],
      );
    }
    if (input.admin) {
      await client.query(
        `insert into admin_notifications
           (id,source_event_id,case_id,category,title,body,event_slug,deep_link)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id("notice"),
          eventId,
          caseId,
          input.admin.category ?? input.kind,
          input.admin.title,
          input.admin.body,
          input.eventSlug ?? null,
          adminDeepLink,
        ],
      );
    }
    return { id: eventId, created: true };
  });

  if (result.created && input.admin && (severity === "warning" || severity === "critical")) {
    await deliverImmediateAlerts({
      sourceEventId: result.id,
      category: input.admin.category ?? input.kind,
      severity,
      title: input.admin.title,
      body: input.admin.body,
      deepLink: adminDeepLink!,
      eventSlug: input.eventSlug,
    });
  }
  return result;
}

async function deliverImmediateAlerts(input: {
  sourceEventId: string;
  category: string;
  severity: "warning" | "critical";
  title: string;
  body: string;
  deepLink: string;
  eventSlug?: string;
}): Promise<void> {
  const recipients = await query<{
    id: string;
    email_address: string;
    quiet_hours: { start?: number; end?: number } | null;
    critical_override: boolean;
  }>(
    `select id,email_address,quiet_hours,critical_override from admin_alert_recipients
      where status = 'active' and cadence = 'immediate'
        and (fallback or $1 = any(categories) or 'all' = any(categories)
             or ($2 = 'critical' and critical_override))
        and (cardinality(event_slugs) = 0 or $3 = any(event_slugs))`,
    [input.category, input.severity, input.eventSlug ?? ""],
  );
  const origin = process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim();
  if (!origin) return;
  const actionUrl = buildAppUrl(origin, input.deepLink);
  for (const recipient of recipients) {
    if (
      isQuietHour(recipient.quiet_hours, new Date().getUTCHours()) &&
      !(input.severity === "critical" && recipient.critical_override)
    )
      continue;
    await sendEmail(
      {
        channel: "operations",
        to: recipient.email_address,
        subject: `${input.severity === "critical" ? "Critical" : "Needs attention"}: ${input.title}`,
        text: `${input.title}\n\n${input.body}\n\nOpen the authorised record: ${actionUrl}`,
        html: renderBrandedEmail({
          origin,
          label: "operations alert",
          title: input.title,
          contentHtml: `<p>${escapeEmailHtml(input.body)}</p>`,
          action: { label: "open in admin", url: actionUrl },
          note: "Personal details are kept in the authorised admin record, not this email.",
        }),
      },
      {
        idempotencyKey: `operations-alert:${input.sourceEventId}:${recipient.id}`,
        kind: "operations-alert",
        source: "system",
        context: { eventSlug: input.eventSlug, caseId: input.sourceEventId },
      },
    );
  }
}

function isQuietHour(quietHours: { start?: number; end?: number } | null, hour: number): boolean {
  const start = quietHours?.start;
  const end = quietHours?.end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start === end) return false;
  if (start! < end!) return hour >= start! && hour < end!;
  return hour >= start! || hour < end!;
}

export type AlertRecipient = {
  id: string;
  personId: string;
  emailHint: string;
  categories: string[];
  eventSlugs: string[];
  cadence: "immediate" | "digest";
  digestHour?: number;
  quietHours: { start?: number; end?: number };
  criticalOverride: boolean;
  fallback: boolean;
  status: "active" | "paused" | "revoked";
  updatedAt: string;
};

export type AlertDelivery = {
  id: string;
  recipientHint: string;
  subjectHint: string;
  kind: "operations-alert" | "operations-digest";
  status: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
};

export async function listAlertRecipients(): Promise<AlertRecipient[]> {
  const rows = await query<{
    id: string;
    person_id: string;
    email_hint: string;
    categories: string[];
    event_slugs: string[];
    cadence: "immediate" | "digest";
    digest_hour: number | null;
    quiet_hours: { start?: number; end?: number };
    critical_override: boolean;
    fallback: boolean;
    status: "active" | "paused" | "revoked";
    updated_at: Date;
  }>(`select * from admin_alert_recipients order by status,created_at desc`);
  return rows.map((row) => ({
    id: row.id,
    personId: row.person_id,
    emailHint: row.email_hint,
    categories: row.categories,
    eventSlugs: row.event_slugs,
    cadence: row.cadence,
    digestHour: row.digest_hour ?? undefined,
    quietHours: row.quiet_hours ?? {},
    criticalOverride: row.critical_override,
    fallback: row.fallback,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function listAlertDeliveries(limit = 30): Promise<AlertDelivery[]> {
  const rows = await query<{
    id: string;
    recipient_hint: string;
    subject_hint: string;
    kind: AlertDelivery["kind"];
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: Date;
  }>(
    `select id,recipient_hint,subject_hint,kind,status,attempts,last_error,created_at
       from email_outbox
      where kind in ('operations-alert','operations-digest')
      order by created_at desc limit $1`,
    [Math.min(100, Math.max(1, Math.trunc(limit)))],
  );
  return rows.map((row) => ({
    id: row.id,
    recipientHint: row.recipient_hint,
    subjectHint: row.subject_hint,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function sendTestAlert(input: {
  recipientId: string;
  actorId: string;
}): Promise<{ queued: boolean }> {
  const rows = await query<{ email_address: string }>(
    `select email_address from admin_alert_recipients where id = $1 and status = 'active'`,
    [input.recipientId],
  );
  const email = rows[0]?.email_address;
  if (!email) throw new Error("Active alert recipient not found");
  const appOrigin = process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim();
  if (!appOrigin) throw new Error("Application URL is not configured");
  const delivery = await sendEmail(
    {
      channel: "operations",
      to: email,
      subject: "Milk & Henny operations test alert",
      text: `Your operations alerts are configured.\n\nOpen admin: ${buildAppUrl(appOrigin, "/admin?view=operations")}`,
      html: renderBrandedEmail({
        origin: appOrigin,
        label: "operations alert test",
        title: "Your alerts are configured",
        contentHtml: "<p>This test confirms the durable operations email route is available.</p>",
        action: {
          label: "open operations inbox",
          url: buildAppUrl(appOrigin, "/admin?view=operations"),
        },
      }),
    },
    {
      idempotencyKey: `operations-alert-test:${input.recipientId}:${Date.now()}`,
      kind: "operations-alert",
      source: "admin",
      context: { caseId: `test-by:${input.actorId}` },
    },
  );
  return { queued: delivery.ok };
}

export async function saveAlertRecipient(input: {
  email: string;
  categories: string[];
  eventSlugs?: string[];
  cadence: "immediate" | "digest";
  digestHour?: number;
  quietHours?: { start?: number; end?: number };
  criticalOverride: boolean;
  fallback: boolean;
  actorId: string;
  actorType: "root-owner" | "admin";
  reason: string;
}): Promise<{ id: string }> {
  if (!isValidEmail(input.email)) throw new Error("Enter a valid verified email");
  if (!input.categories.length) throw new Error("Choose at least one alert category");
  if (!input.reason.trim()) throw new Error("An alert-recipient change requires a reason");
  const digestHour = input.cadence === "digest" ? Math.trunc(input.digestHour ?? -1) : null;
  if (input.cadence === "digest" && (digestHour === null || digestHour < 0 || digestHour > 23))
    throw new Error("Choose a digest hour from 0 to 23 UTC");
  const email = normaliseEmail(input.email);
  const emailHash = actionEmailHash(email);
  const quietHours = input.quietHours ?? {};
  for (const value of [quietHours.start, quietHours.end]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 23))
      throw new Error("Quiet hours must use UTC hours from 0 to 23");
  }
  return transaction(async (client) => {
    const identifier = await client.query<{ person_id: string }>(
      `select person_id from event_person_identifiers
        where kind = 'email' and value_hash = $1 and verified_at is not null`,
      [emailHash],
    );
    const personId = identifier.rows[0]?.person_id;
    if (!personId)
      throw new Error("That mailbox must verify attendee access before it can receive alerts");
    const existing = await client.query<{
      id: string;
      categories: string[];
      event_slugs: string[];
      cadence: string;
      digest_hour: number | null;
      status: string;
    }>(
      `select id,categories,event_slugs,cadence,digest_hour,status
         from admin_alert_recipients
        where email_hash = $1 and status in ('active','paused') for update`,
      [emailHash],
    );
    const before = existing.rows[0];
    const recipientId = before?.id ?? id("alert_recipient");
    await client.query(
      `insert into admin_alert_recipients
         (id,person_id,email_hash,email_hint,email_address,categories,event_slugs,cadence,digest_hour,
          quiet_hours,critical_override,fallback,status,verified_at)
       values ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10::jsonb,$11,$12,'active',now())
       on conflict (email_hash) where status in ('active','paused') do update
         set person_id = excluded.person_id,email_hint = excluded.email_hint,
             email_address = excluded.email_address,
             categories = excluded.categories,event_slugs = excluded.event_slugs,
             cadence = excluded.cadence,digest_hour = excluded.digest_hour,
             quiet_hours = excluded.quiet_hours,
             critical_override = excluded.critical_override,fallback = excluded.fallback,
             status = 'active',updated_at = now()`,
      [
        recipientId,
        personId,
        emailHash,
        maskActionEmail(email),
        email,
        input.categories,
        input.eventSlugs ?? [],
        input.cadence,
        digestHour,
        JSON.stringify(quietHours),
        input.criticalOverride,
        input.fallback,
      ],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,correlation_id)
       values ('alerts.recipient.saved',$1,$2,'alert-recipient',$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        input.actorType,
        input.actorId,
        recipientId,
        JSON.stringify(before ?? null),
        JSON.stringify({
          personId,
          categories: input.categories,
          eventSlugs: input.eventSlugs ?? [],
          cadence: input.cadence,
          digestHour,
          quietHours,
          status: "active",
        }),
        input.reason.trim(),
        randomUUID(),
      ],
    );
    return { id: recipientId };
  });
}

export async function revokeAlertRecipient(input: {
  id: string;
  actorId: string;
  actorType: "root-owner" | "admin";
  reason: string;
}): Promise<boolean> {
  if (!input.reason.trim()) throw new Error("A revocation reason is required");
  return transaction(async (client) => {
    const rows = await client.query<{ status: string; email_hint: string }>(
      `update admin_alert_recipients set status = 'revoked',updated_at = now()
        where id = $1 and status <> 'revoked' returning status,email_hint`,
      [input.id],
    );
    const before = rows.rows[0];
    if (!before) return false;
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason)
       values ('alerts.recipient.revoked',$1,$2,'alert-recipient',$3,$4::jsonb,
               '{"status":"revoked"}'::jsonb,$5)`,
      [input.actorType, input.actorId, input.id, JSON.stringify(before), input.reason.trim()],
    );
    return true;
  });
}

export async function sendOperationsDigests(now = new Date()): Promise<{
  recipients: number;
  queued: number;
  skipped: number;
}> {
  const recipients = await query<{
    id: string;
    email_address: string;
    digest_hour: number | null;
  }>(
    `select id,email_address,digest_hour from admin_alert_recipients
      where status = 'active' and cadence = 'digest'`,
  );
  let queued = 0;
  let skipped = 0;
  const hour = now.getUTCHours();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60_000);
  const origin = process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim();
  for (const recipient of recipients) {
    if (recipient.digest_hour !== hour || !origin) {
      skipped += 1;
      continue;
    }
    const items = await query<{ title: string; body: string; deep_link: string }>(
      `select notification.title,notification.body,notification.deep_link
         from admin_notifications notification
         join admin_alert_recipients recipient on recipient.id = $1
        where notification.created_at >= $2
          and notification.status in ('new','in-progress')
          and (cardinality(recipient.event_slugs) = 0 or notification.event_slug = any(recipient.event_slugs))
          and (recipient.fallback or 'all' = any(recipient.categories)
               or notification.category = any(recipient.categories))
        order by notification.created_at desc limit 50`,
      [recipient.id, windowStart],
    );
    if (!items.length) {
      skipped += 1;
      continue;
    }
    const inboxUrl = buildAppUrl(origin, "/admin?view=operations");
    const text = [
      "Operations digest",
      "",
      ...items.flatMap((item) => [`• ${item.title}`, item.body, ""]),
      `Open the inbox: ${inboxUrl}`,
    ].join("\n");
    const delivery = await sendEmail(
      {
        channel: "operations",
        to: recipient.email_address,
        subject: `${items.length} operations item${items.length === 1 ? "" : "s"} to review`,
        text,
        html: renderBrandedEmail({
          origin,
          label: "operations digest",
          title: `${items.length} item${items.length === 1 ? "" : "s"} to review`,
          contentHtml: `<ul>${items.map((item) => `<li><strong>${escapeEmailHtml(item.title)}</strong><br>${escapeEmailHtml(item.body)}</li>`).join("")}</ul>`,
          action: { label: "open operations inbox", url: inboxUrl },
        }),
      },
      {
        idempotencyKey: `operations-digest:${recipient.id}:${now.toISOString().slice(0, 13)}`,
        kind: "operations-digest",
        source: "scheduled",
      },
    );
    if (delivery.ok) queued += 1;
    else skipped += 1;
  }
  return { recipients: recipients.length, queued, skipped };
}

export async function listAdminInbox(input: {
  viewer: AdminNotificationViewer;
  status?: AdminInboxItem["status"];
  category?: string;
  severity?: DomainEventSeverity;
  eventSlug?: string;
  active?: boolean;
  limit?: number;
}): Promise<{
  unresolved: number;
  unread: number;
  items: AdminInboxItem[];
  administrators: Array<{ personId: string; name: string }>;
}> {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 40)));
  const [counts, rows, administrators] = await Promise.all([
    query<{ unresolved: string; unread: string }>(
      `select
         count(*) filter (where notification.status in ('new','in-progress'))::text as unresolved,
         count(*) filter (
           where notification.status in ('new','in-progress') and not exists (
             select 1 from admin_notification_reads personal
              where personal.notification_id = notification.id
                and personal.actor_type = $1 and personal.actor_id = $2
           )
         )::text as unread
       from admin_notifications notification`,
      [input.viewer.actorType, input.viewer.actorId],
    ),
    query<{
      id: string;
      case_id: string | null;
      category: string;
      severity: DomainEventSeverity;
      assignee_person_id: string | null;
      assignee_name: string | null;
      private_note: unknown;
      resolution_reason: string | null;
      title: string;
      body: string;
      event_slug: string | null;
      deep_link: string;
      status: AdminInboxItem["status"];
      created_at: Date;
      updated_at: Date;
      read_at: Date | null;
    }>(
      `select notification.id,notification.case_id,notification.category,
              coalesce(attention.severity,domain.severity) as severity,
              attention.assignee_person_id,person.canonical_name as assignee_name,
              attention.private_note,attention.resolution_reason,
              notification.title,notification.body,notification.event_slug,
              notification.deep_link,notification.status,personal.read_at,
              notification.created_at,notification.updated_at
         from admin_notifications notification
         join attendee_domain_events domain on domain.id = notification.source_event_id
         left join admin_attention_cases attention on attention.id = notification.case_id
         left join event_people person on person.id = attention.assignee_person_id
         left join admin_notification_reads personal
           on personal.notification_id = notification.id
          and personal.actor_type = $1 and personal.actor_id = $2
        where ($3::text is null or notification.status = $3)
          and ($4::text is null or notification.category = $4)
          and ($5::text is null or coalesce(attention.severity,domain.severity) = $5)
          and ($6::text is null or notification.event_slug = $6)
          and (not $7::boolean or notification.status in ('new','in-progress'))
        order by notification.created_at desc limit $8`,
      [
        input.viewer.actorType,
        input.viewer.actorId,
        input.status ?? null,
        input.category ?? null,
        input.severity ?? null,
        input.eventSlug ?? null,
        input.active === true,
        limit,
      ],
    ),
    query<{ person_id: string; canonical_name: string | null }>(
      `select distinct admin_grant.person_id,person.canonical_name
         from global_admin_grants admin_grant
         join event_people person on person.id = admin_grant.person_id
        where admin_grant.status = 'active'
          and (admin_grant.expires_at is null or admin_grant.expires_at > now())
        order by person.canonical_name nulls last,admin_grant.person_id`,
    ),
  ]);
  return {
    unresolved: Number(counts[0]?.unresolved) || 0,
    unread: Number(counts[0]?.unread) || 0,
    items: rows.map((row) => ({
      id: row.id,
      caseId: row.case_id ?? undefined,
      category: row.category,
      severity: row.severity,
      assigneePersonId: row.assignee_person_id ?? undefined,
      assigneeName: row.assignee_name ?? undefined,
      privateNote:
        row.private_note && typeof row.private_note === "object" && !Array.isArray(row.private_note)
          ? (row.private_note as AdminInboxItem["privateNote"])
          : undefined,
      resolutionReason: row.resolution_reason ?? undefined,
      title: row.title,
      body: row.body,
      eventSlug: row.event_slug ?? undefined,
      deepLink: row.deep_link,
      status: row.status,
      unread: row.read_at === null,
      readAt: row.read_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
    administrators: administrators.map((administrator) => ({
      personId: administrator.person_id,
      name: administrator.canonical_name ?? administrator.person_id,
    })),
  };
}

export async function setAdminNotificationReadState(input: {
  id: string;
  viewer: AdminNotificationViewer;
  read: boolean;
}): Promise<boolean> {
  return transaction(async (client) => {
    const notification = await client.query(`select 1 from admin_notifications where id = $1`, [
      input.id,
    ]);
    if (!notification.rowCount) return false;
    if (input.read) {
      await client.query(
        `insert into admin_notification_reads (notification_id,actor_type,actor_id,read_at)
         values ($1,$2,$3,now())
         on conflict (notification_id,actor_type,actor_id)
         do update set read_at = excluded.read_at`,
        [input.id, input.viewer.actorType, input.viewer.actorId],
      );
    } else {
      await client.query(
        `delete from admin_notification_reads
          where notification_id = $1 and actor_type = $2 and actor_id = $3`,
        [input.id, input.viewer.actorType, input.viewer.actorId],
      );
    }
    return true;
  });
}

export async function updateAdminNotification(input: {
  id: string;
  status: AdminInboxItem["status"];
  actorId: string;
  actorType: "root-owner" | "admin";
  reason?: string;
  assigneePersonId?: string | null;
  privateNote?: string;
}): Promise<boolean> {
  if ((input.status === "resolved" || input.status === "dismissed") && !input.reason?.trim())
    throw new Error("A resolution reason is required");
  return transaction(async (client) => {
    const selected = await client.query<{
      case_id: string | null;
      status: string;
      category: string;
      related_entities: Record<string, unknown> | null;
    }>(
      `select notification.case_id,notification.status,notification.category,
              attention.related_entities
         from admin_notifications notification
         left join admin_attention_cases attention on attention.id = notification.case_id
        where notification.id = $1
        for update of notification`,
      [input.id],
    );
    const before = selected.rows[0];
    if (!before) return false;
    if (
      before.category === "email-delivery" &&
      (input.status === "resolved" || input.status === "dismissed")
    ) {
      const recipientHash = before.related_entities?.recipientHash;
      if (typeof recipientHash === "string") {
        const activeBlock = await client.query(
          `select 1 from email_suppressions where recipient_hash = $1`,
          [recipientHash],
        );
        if (activeBlock.rowCount) {
          throw new Error("Resolve the delivery block before closing this notification");
        }
      }
    }
    const rows = await client.query<{ case_id: string | null }>(
      `update admin_notifications
          set status = $2, updated_at = now(),
              resolved_at = case when $2 in ('resolved','dismissed') then now() else null end
        where id = $1 returning case_id`,
      [input.id, input.status],
    );
    const row = rows.rows[0];
    if (!row) return false;
    if (row.case_id) {
      if (input.assigneePersonId) {
        const administrator = await client.query(
          `select 1 from global_admin_grants
            where person_id = $1 and status = 'active'
              and (expires_at is null or expires_at > now()) limit 1`,
          [input.assigneePersonId],
        );
        if (!administrator.rowCount) throw new Error("Assignee is not an active administrator");
      }
      await client.query(
        `update admin_attention_cases
            set status = $2, updated_at = now(), resolution_reason = coalesce($3,resolution_reason),
                assignee_person_id = case when $7::boolean then $4 else assignee_person_id end,
                private_note = case when $5::text is null then private_note else
                  jsonb_build_object('body',$5::text,'actorId',$6::text,'updatedAt',now()) end,
                resolved_at = case when $2 in ('resolved','dismissed') then now() else null end
          where id = $1`,
        [
          row.case_id,
          input.status,
          input.reason?.trim() || null,
          input.assigneePersonId ?? null,
          input.privateNote?.trim() || null,
          input.actorId,
          input.assigneePersonId !== undefined,
        ],
      );
    }
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason)
       values ('notification.status.updated',$1,$2,'notification',$3,$4::jsonb,$5::jsonb,$6)`,
      [
        input.actorType,
        input.actorId,
        input.id,
        JSON.stringify({ status: before.status }),
        JSON.stringify({ status: input.status }),
        input.reason?.trim() || "status updated",
      ],
    );
    return true;
  });
}
