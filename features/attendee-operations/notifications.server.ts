import { randomUUID } from "node:crypto";

import { sendEmail } from "@/lib/platform/email.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";

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
    deepLink: string;
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
  deepLink: string;
  status: "new" | "seen" | "in-progress" | "resolved" | "dismissed";
  createdAt: string;
  updatedAt: string;
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export async function emitDomainEvent(
  input: DomainEventInput,
): Promise<{ id: string; created: boolean }> {
  const severity = input.severity ?? "info";
  const correlationId = input.correlationId ?? randomUUID();
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
           (id,source_event_id,case_id,title,body,event_slug,deep_link)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id("notice"),
          eventId,
          caseId,
          input.admin.title,
          input.admin.body,
          input.eventSlug ?? null,
          input.admin.deepLink,
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
      deepLink: input.admin.deepLink,
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
  const recipients = await query<{ id: string; email_hint: string }>(
    `select id,email_hint from admin_alert_recipients
      where status = 'active' and cadence = 'immediate'
        and ($1 = any(categories) or 'all' = any(categories) or ($2 = 'critical' and critical_override))
        and (cardinality(event_slugs) = 0 or $3 = any(event_slugs))`,
    [input.category, input.severity, input.eventSlug ?? ""],
  );
  const origin = process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim();
  if (!origin) return;
  const actionUrl = buildAppUrl(origin, input.deepLink);
  for (const recipient of recipients) {
    // A verified recipient's raw address is deliberately not retained in the
    // settings projection. It is resolved from their verified person identity.
    const emailRows = await query<{ email: string }>(
      `select c.email
         from admin_alert_recipients r
         join event_person_identifiers i on i.person_id = r.person_id and i.kind = 'email'
         join event_person_login_challenges c on c.email_hash = i.value_hash
        where r.id = $1 and i.verified_at is not null
        order by c.created_at desc limit 1`,
      [recipient.id],
    );
    const email = emailRows[0]?.email;
    if (!email) continue;
    await sendEmail(
      {
        channel: "operations",
        to: email,
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

export async function listAdminInbox(
  input: {
    status?: AdminInboxItem["status"];
    limit?: number;
  } = {},
): Promise<{ unresolved: number; items: AdminInboxItem[] }> {
  const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 40)));
  const [counts, rows] = await Promise.all([
    query<{ count: string }>(
      `select count(*)::text as count from admin_notifications
        where status in ('new','seen','in-progress')`,
    ),
    query<{
      id: string;
      case_id: string | null;
      title: string;
      body: string;
      event_slug: string | null;
      deep_link: string;
      status: AdminInboxItem["status"];
      created_at: Date;
      updated_at: Date;
    }>(
      `select id,case_id,title,body,event_slug,deep_link,status,created_at,updated_at
         from admin_notifications
        where ($1::text is null or status = $1)
        order by created_at desc limit $2`,
      [input.status ?? null, limit],
    ),
  ]);
  return {
    unresolved: Number(counts[0]?.count) || 0,
    items: rows.map((row) => ({
      id: row.id,
      caseId: row.case_id ?? undefined,
      title: row.title,
      body: row.body,
      eventSlug: row.event_slug ?? undefined,
      deepLink: row.deep_link,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    })),
  };
}

export async function updateAdminNotification(input: {
  id: string;
  status: AdminInboxItem["status"];
  actorId: string;
  reason?: string;
}): Promise<boolean> {
  return transaction(async (client) => {
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
      await client.query(
        `update admin_attention_cases
            set status = $2, updated_at = now(), resolution_reason = coalesce($3,resolution_reason),
                resolved_at = case when $2 in ('resolved','dismissed') then now() else null end
          where id = $1`,
        [row.case_id, input.status, input.reason?.trim() || null],
      );
    }
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,after_state,reason)
       values ('notification.status.updated','admin',$1,'notification',$2,$3::jsonb,$4)`,
      [
        input.actorId,
        input.id,
        JSON.stringify({ status: input.status }),
        input.reason?.trim() || null,
      ],
    );
    return true;
  });
}
