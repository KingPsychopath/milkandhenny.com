import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { query } from "@/lib/platform/postgres.server";
import type { SurveyIdentityMode, SurveyInvitationContext } from "./types";

const INVITATION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;

type InvitationPayload = { v: 1; id: string; expiresAt: number };

function secret(): string | null {
  return process.env.AUTH_SECRET?.trim() || null;
}

function sign(encoded: string, value: string): string {
  return createHmac("sha256", value)
    .update(`milk-henny-survey-invitation:${encoded}`)
    .digest("base64url");
}

function createToken(id: string, expiresAt: Date): string | null {
  const value = secret();
  if (!value) return null;
  const encoded = Buffer.from(
    JSON.stringify({ v: 1, id, expiresAt: expiresAt.getTime() } satisfies InvitationPayload),
  ).toString("base64url");
  return `${encoded}.${sign(encoded, value)}`;
}

function verifyToken(token: string): InvitationPayload | null {
  const value = secret();
  const [encoded, supplied, extra] = token.split(".");
  if (!value || !encoded || !supplied || extra) return null;
  const expected = sign(encoded, value);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<InvitationPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id) ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }
    return parsed as InvitationPayload;
  } catch {
    return null;
  }
}

function surveySlug(destination: string, origin: string): string | null {
  try {
    const url = new URL(destination, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const match = /^\/surveys\/([a-z0-9][a-z0-9-]{1,80})\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function issueSurveyInvitationForDestination(input: {
  destination: string;
  origin: string;
  recipientHash: string;
  sourceType: "message" | "stage" | "test";
  sourceId: string;
}): Promise<{ id: string; expiresAt: Date } | null> {
  const slug = surveySlug(input.destination, input.origin);
  if (!slug || !secret()) return null;
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  const rows = await query<{ id: string; expires_at: Date }>(
    `insert into survey_invitations
       (id, survey_id, recipient_hash, source_type, source_id, expires_at)
     select $1, s.id, $2, $3, $4, $5
       from surveys s
      where s.slug = $6 and s.identity_mode <> 'anonymous'
     on conflict (survey_id, recipient_hash, source_type, source_id) do update
       set expires_at = greatest(survey_invitations.expires_at, excluded.expires_at),
           updated_at = now()
     returning id, expires_at`,
    [randomUUID(), input.recipientHash, input.sourceType, input.sourceId, expiresAt, slug],
  );
  return rows[0] ? { id: rows[0].id, expiresAt: new Date(rows[0].expires_at) } : null;
}

export function addSurveyInvitationToDestination(
  destination: string,
  invitationId: string,
  expiresAt: Date,
): string {
  const token = createToken(invitationId, expiresAt);
  if (!token) return destination;
  const absolute = /^https?:\/\//i.test(destination);
  const url = new URL(destination, "https://milkandhenny.invalid");
  url.searchParams.set("invite", token);
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export async function resolveSurveyInvitation(
  token: string | undefined,
  slug: string,
  markOpened = false,
): Promise<SurveyInvitationContext | null> {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const rows = await query<{
    id: string;
    expires_at: Date;
    completed_at: Date | null;
    identity_mode: SurveyIdentityMode;
    email: string;
    display_name: string | null;
  }>(
    `select i.id, i.expires_at, i.completed_at, s.identity_mode,
            c.email, c.display_name
       from survey_invitations i
       join surveys s on s.id = i.survey_id
       join communication_contacts c on c.email_hash = i.recipient_hash
      where i.id = $1 and s.slug = $2 and i.expires_at > now()
        and s.identity_mode <> 'anonymous'`,
    [payload.id, slug],
  );
  const row = rows[0];
  if (!row || row.identity_mode === "anonymous") return null;
  if (markOpened) {
    await query(
      `update survey_invitations
          set opened_at = coalesce(opened_at, now()), updated_at = now()
        where id = $1`,
      [row.id],
    );
  }
  return {
    id: row.id,
    token,
    respondentEmail: row.email,
    respondentName: row.display_name,
    identityMode: row.identity_mode,
    completed: Boolean(row.completed_at),
  };
}

export const __surveyInvitationTesting = { createToken, verifyToken, surveySlug };
