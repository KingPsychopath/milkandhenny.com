import { randomUUID } from "node:crypto";

import { establishEmailAuthenticatedSession } from "@/features/attendee-access/email-authentication.server";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import { sendEmail } from "@/lib/platform/email.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import {
  actionEmailHash,
  consumeActionLink,
  inspectActionLink,
  issueActionLink,
  maskActionEmail,
  revokeActionLink,
} from "./action-links.server";
import { createOrResolveInvitedPerson, ensurePendingInvitedPerson } from "./invited-person.server";
import { emitDomainEvent } from "./notifications.server";
import { GLOBAL_ADMIN_ROLE_PRESETS, type GlobalAdminRole } from "./types";
import { identityMayAcquire } from "./identity-policy.server";

const ADMIN_ROLE_PRESETS = Object.keys(GLOBAL_ADMIN_ROLE_PRESETS) as GlobalAdminRole[];
export type AdminRolePreset = GlobalAdminRole;

export type AccessGrantResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

export type AccessActionPreview = {
  purpose: "staff-invitation" | "admin-invitation";
  state: "available" | "completed" | "cancelled" | "expired";
  title: string;
  label: string;
  eventSlug?: string;
  intendedEmailHint: string;
  expiresAt: string;
};

class AccessGrantError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccessGrantError";
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

function origin(value?: string): string | null {
  return (
    value?.trim() || process.env.APP_BASE_URL?.trim() || process.env.VITE_BASE_URL?.trim() || null
  );
}

function invitationEmail(input: {
  origin: string;
  recipient: string;
  title: string;
  label: string;
  actionUrl: string;
  expiresAt: Date;
}) {
  const text = [
    input.title,
    "",
    `Access: ${input.label}`,
    `Accept: ${input.actionUrl}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    "",
    "This private link works once. It attaches access to this verified email and does not merge another signed-in identity.",
    "",
    "— milk & henny",
  ].join("\n");
  return {
    text,
    html: renderBrandedEmail({
      origin: input.origin,
      label: "private access",
      title: input.title,
      contentHtml: `<p style="margin:0">You have been invited as <strong>${escapeEmailHtml(input.label)}</strong>.</p>`,
      action: { label: "review access", url: input.actionUrl },
      note: `This private link expires ${escapeEmailHtml(input.expiresAt.toISOString())} and works once.`,
    }),
  };
}

export async function inviteNamedAdmin(input: {
  email: string;
  name?: string;
  rolePreset: AdminRolePreset;
  overrides?: Record<string, boolean>;
  expiresAt?: string;
  actorId: string;
  actorType: "root-owner" | "admin";
  reason: string;
  origin?: string;
}): Promise<AccessGrantResult<{ grantId: string; expiresAt: string; emailQueued: boolean }>> {
  if (!isValidEmail(input.email))
    return { ok: false, status: 400, error: "Enter a valid email address" };
  if (!ADMIN_ROLE_PRESETS.includes(input.rolePreset))
    return { ok: false, status: 400, error: "Choose a valid admin role" };
  if (!input.reason.trim())
    return { ok: false, status: 400, error: "A reason is required for admin access" };
  const appOrigin = origin(input.origin);
  if (!appOrigin) return { ok: false, status: 503, error: "Application URL is not configured" };
  const email = normaliseEmail(input.email);
  if (!(await identityMayAcquire(email))) {
    return {
      ok: false,
      status: 403,
      error: "This identity cannot receive new admin permissions. Existing access is unchanged.",
    };
  }
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + 72 * 60 * 60_000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    return { ok: false, status: 400, error: "Invitation expiry must be in the future" };

  const created = await transaction(async (client) => {
    const person = await ensurePendingInvitedPerson(client, {
      emailHash: actionEmailHash(email),
      emailHint: maskActionEmail(email),
      emailAddress: email,
      canonicalName: input.name,
    });
    const before = await client.query<{
      id: string;
      status: string;
      invitation_link_id: string | null;
    }>(
      `select id,status,invitation_link_id from global_admin_grants
        where person_id = $1 and role_preset = $2
          and status in ('pending','active','paused') for update`,
      [person.personId, input.rolePreset],
    );
    const previous = before.rows[0];
    if (previous?.status === "active" || previous?.status === "paused")
      throw new AccessGrantError(409, "That person already has this admin role");
    if (previous) {
      await client.query(
        `update global_admin_grants set status = 'revoked',revoked_at = now() where id = $1`,
        [previous.id],
      );
      if (previous.invitation_link_id)
        await revokeActionLink(client, previous.invitation_link_id, "replaced-by-new-invitation");
    }
    const grantId = id("admin_grant");
    const link = await issueActionLink(client, {
      purpose: "admin-invitation",
      intendedEmail: email,
      entityType: "global-admin-grant",
      entityId: grantId,
      issuedByType: input.actorType,
      issuedById: input.actorId,
      expiresAt,
    });
    await client.query(
      `insert into global_admin_grants
         (id,person_id,role_preset,overrides,status,expires_at,issued_by_type,issued_by_id,invitation_link_id)
       values ($1,$2,$3,$4::jsonb,'pending',$5,$6,$7,$8)`,
      [
        grantId,
        person.personId,
        input.rolePreset,
        JSON.stringify(input.overrides ?? {}),
        expiresAt,
        input.actorType,
        input.actorId,
        link.id,
      ],
    );
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,correlation_id)
       values ('admin.invitation.issued',$1,$2,'global-admin-grant',$3,$4::jsonb,$5::jsonb,$6,$7)`,
      [
        input.actorType,
        input.actorId,
        grantId,
        JSON.stringify(previous ? { id: previous.id, status: previous.status } : null),
        JSON.stringify({
          status: "pending",
          rolePreset: input.rolePreset,
          personId: person.personId,
        }),
        input.reason.trim(),
        randomUUID(),
      ],
    );
    return { grantId, token: link.token };
  }).catch((error: unknown) => {
    if (error instanceof AccessGrantError) return error;
    throw error;
  });
  if (created instanceof AccessGrantError)
    return { ok: false, status: created.status, error: created.message };

  const actionUrl = buildAppUrl(appOrigin, `/action/${created.token}`);
  const rendered = invitationEmail({
    origin: appOrigin,
    recipient: email,
    title: "Admin access invitation",
    label: input.rolePreset,
    actionUrl,
    expiresAt,
  });
  const delivery = await sendEmail(
    {
      channel: "access",
      to: email,
      subject: "Your Milk & Henny admin invitation",
      text: rendered.text,
      html: rendered.html,
    },
    {
      idempotencyKey: `admin-access:${created.grantId}`,
      kind: "admin-access",
      source: "admin",
      context: { adminGrantId: created.grantId },
    },
  );
  if (!delivery.ok) {
    await emitDomainEvent({
      kind: "admin.invitation_email_failed",
      deduplicationKey: `admin-grant:${created.grantId}:email-failed`,
      actorType: "system",
      entityRefs: { adminGrantId: created.grantId },
      severity: "warning",
      admin: {
        title: "Admin invitation email failed",
        body: "The grant remains pending. Review email delivery before issuing a replacement.",
        deepLink: "/admin?view=operations",
        category: "access-email-failed",
        createCase: true,
      },
    });
  }
  return {
    ok: true,
    value: {
      grantId: created.grantId,
      expiresAt: expiresAt.toISOString(),
      emailQueued: delivery.ok,
    },
  };
}

export async function inspectAccessAction(token: string): Promise<AccessActionPreview | null> {
  const link = await inspectActionLink(token);
  if (!link || (link.purpose !== "admin-invitation" && link.purpose !== "staff-invitation"))
    return null;
  if (link.purpose === "admin-invitation") {
    const rows = await query<{ role_preset: string; status: string; expires_at: Date | null }>(
      `select role_preset,status,expires_at from global_admin_grants where id = $1`,
      [link.entityId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      purpose: link.purpose,
      state:
        link.expiresAt <= new Date().toISOString()
          ? "expired"
          : row.status === "pending"
            ? "available"
            : row.status === "active"
              ? "completed"
              : "cancelled",
      title: "Admin access",
      label: row.role_preset,
      intendedEmailHint: link.intendedEmailHint,
      expiresAt: row.expires_at?.toISOString() ?? link.expiresAt,
    };
  }
  const rows = await query<{
    label: string;
    event_slug: string;
    invitation_state: string;
    expires_at: Date | null;
  }>(
    `select label,event_slug,invitation_state,expires_at from score_staff_assignments where id = $1`,
    [link.entityId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    purpose: link.purpose,
    state:
      link.expiresAt <= new Date().toISOString()
        ? "expired"
        : row.invitation_state === "pending"
          ? "available"
          : row.invitation_state === "active"
            ? "completed"
            : "cancelled",
    title: "Event staff access",
    label: row.label,
    eventSlug: row.event_slug,
    intendedEmailHint: link.intendedEmailHint,
    expiresAt: row.expires_at?.toISOString() ?? link.expiresAt,
  };
}

export async function acceptAccessAction(token: string): Promise<
  AccessGrantResult<{
    purpose: AccessActionPreview["purpose"];
    destination: string;
    mfaRequired: boolean;
  }>
> {
  try {
    const consumed = await consumeActionLink(token, async (client, link) => {
      if (link.purpose !== "admin-invitation" && link.purpose !== "staff-invitation")
        throw new AccessGrantError(400, "This link is for a different action");
      const person = await createOrResolveInvitedPerson(client, link);
      if (link.purpose === "admin-invitation") {
        const rows = await client.query<{ role_preset: string }>(
          `update global_admin_grants
              set person_id = $2,status = 'active',activated_at = now()
            where id = $1 and status = 'pending' and starts_at <= now()
              and (expires_at is null or expires_at > now())
            returning role_preset`,
          [link.entityId, person.personId],
        );
        const row = rows.rows[0];
        if (!row) throw new AccessGrantError(409, "This admin invitation is no longer available");
        await client.query(
          `insert into attendee_operations_audit_events
             (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,correlation_id)
           values ('admin.invitation.accepted','admin',$1,'global-admin-grant',$2,
                   '{"status":"pending"}'::jsonb,$3::jsonb,'accepted-by-invited-email',$4)`,
          [
            person.personId,
            link.entityId,
            JSON.stringify({ status: "active", rolePreset: row.role_preset }),
            randomUUID(),
          ],
        );
        await client.query(`update attendee_action_links set consumed_by = $2 where id = $1`, [
          link.id,
          person.personId,
        ]);
        return {
          purpose: link.purpose,
          personId: person.personId,
          verifiedEmailHash: link.intendedEmailHash,
          destination: "/admin",
        };
      }

      const rows = await client.query<{ event_slug: string }>(
        `update score_staff_assignments
            set person_id = $2,invitation_state = 'active',activated_at = now(),last_used_at = now()
          where id = $1 and assignment_type = 'personal' and status = 'active'
            and invitation_state = 'pending' and (expires_at is null or expires_at > now())
          returning event_slug`,
        [link.entityId, person.personId],
      );
      const row = rows.rows[0];
      if (!row) throw new AccessGrantError(409, "This staff invitation is no longer available");
      await client.query(
        `insert into attendee_operations_audit_events
           (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason,correlation_id)
         values ('staff.invitation.accepted','staff',$1,$2,'staff-assignment',$3,
                 '{"invitationState":"pending"}'::jsonb,
                 '{"invitationState":"active"}'::jsonb,'accepted-by-invited-email',$4)`,
        [person.personId, row.event_slug, link.entityId, randomUUID()],
      );
      await client.query(`update attendee_action_links set consumed_by = $2 where id = $1`, [
        link.id,
        person.personId,
      ]);
      return {
        purpose: link.purpose,
        personId: person.personId,
        verifiedEmailHash: link.intendedEmailHash,
        destination: `/events/${encodeURIComponent(row.event_slug)}/staff/personal`,
      };
    });
    if (!consumed.ok) return consumed;
    const authentication = await establishEmailAuthenticatedSession({
      personId: consumed.value.personId,
      verifiedEmailHash: consumed.value.verifiedEmailHash,
      returnTo: consumed.value.destination,
    });
    return {
      ok: true,
      value: {
        purpose: consumed.value.purpose,
        destination: authentication.destination,
        mfaRequired: authentication.mfaRequired,
      },
    };
  } catch (error) {
    return error instanceof AccessGrantError
      ? { ok: false, status: error.status, error: error.message }
      : { ok: false, status: 503, error: "Access could not be activated" };
  }
}

export async function revokeNamedAdmin(input: {
  grantId: string;
  actorId: string;
  actorType: "root-owner" | "admin";
  reason: string;
}): Promise<boolean> {
  if (!input.reason.trim()) throw new Error("A revocation reason is required");
  return transaction(async (client) => {
    const selected = await client.query<{
      status: string;
      role_preset: string;
      invitation_link_id: string | null;
    }>(
      `select status,role_preset,invitation_link_id from global_admin_grants where id = $1 for update`,
      [input.grantId],
    );
    const before = selected.rows[0];
    if (!before || before.status === "revoked") return false;
    await client.query(
      `update global_admin_grants set status = 'revoked',revoked_at = now() where id = $1`,
      [input.grantId],
    );
    if (before.invitation_link_id)
      await revokeActionLink(client, before.invitation_link_id, "admin-access-revoked");
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,correlation_id)
       values ('admin.access.revoked',$1,$2,'global-admin-grant',$3,$4::jsonb,
               '{"status":"revoked"}'::jsonb,$5,$6)`,
      [
        input.actorType,
        input.actorId,
        input.grantId,
        JSON.stringify({ status: before.status, rolePreset: before.role_preset }),
        input.reason.trim(),
        randomUUID(),
      ],
    );
    return true;
  });
}

export async function listNamedAdminGrants(): Promise<
  Array<{
    id: string;
    personId: string;
    name?: string;
    emailHint?: string;
    rolePreset: AdminRolePreset;
    status: string;
    expiresAt?: string;
    activatedAt?: string;
    createdAt: string;
  }>
> {
  const rows = await query<{
    id: string;
    person_id: string;
    canonical_name: string | null;
    display_hint: string | null;
    role_preset: AdminRolePreset;
    status: string;
    expires_at: Date | null;
    activated_at: Date | null;
    created_at: Date;
  }>(
    `select admin_grant.id,admin_grant.person_id,person.canonical_name,identifier.display_hint,
            admin_grant.role_preset,admin_grant.status,admin_grant.expires_at,
            admin_grant.activated_at,admin_grant.created_at
       from global_admin_grants admin_grant
       join event_people person on person.id = admin_grant.person_id
       left join lateral (
         select display_hint from event_person_identifiers
          where person_id = admin_grant.person_id and kind = 'email'
          order by verified_at desc nulls last,created_at desc limit 1
       ) identifier on true
      order by admin_grant.created_at desc`,
  );
  return rows.map((row) => ({
    id: row.id,
    personId: row.person_id,
    name: row.canonical_name ?? undefined,
    emailHint: row.display_hint ?? undefined,
    rolePreset: row.role_preset,
    status: row.status,
    expiresAt: row.expires_at?.toISOString(),
    activatedAt: row.activated_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  }));
}
