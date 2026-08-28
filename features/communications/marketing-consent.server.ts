import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { transaction } from "@/lib/platform/postgres.server";
import { isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import { MARKETING_CONSENT_VERSION, MARKETING_PRIVACY_NOTICE_VERSION } from "./marketing-consent";

const ADMIN_MARKETING_CONSENT_VERSION = "admin-action-v1";

type ConsentSource = "subscribe" | "ticket_purchase" | "admin" | "unsubscribe";
type ConsentDecision = "granted" | "withdrawn";

function hashEmail(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

function assertEmailHash(emailHash: string): void {
  if (!/^[a-f0-9]{64}$/.test(emailHash)) throw new Error("Invalid contact");
}

async function insertConsentEvent(
  client: PoolClient,
  input: {
    emailHash: string;
    decision: ConsentDecision;
    source: ConsentSource;
    sourceRef?: string | null;
    consentVersion: string;
    privacyVersion: string;
    occurredAt: Date;
  },
): Promise<void> {
  await client.query(
    `insert into communication_contact_consent_events
       (id, email_hash, decision, source, source_ref, consent_version, privacy_version, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict do nothing`,
    [
      randomUUID(),
      input.emailHash,
      input.decision,
      input.source,
      input.sourceRef ?? null,
      input.consentVersion,
      input.privacyVersion,
      input.occurredAt,
    ],
  );
}

export async function recordMarketingConsent(input: {
  email: string;
  displayName?: string | null;
  source: "subscribe" | "ticket_purchase";
  sourceRef?: string | null;
  consentVersion: string;
  privacyVersion: string;
  occurredAt?: Date;
}): Promise<void> {
  const email = normaliseEmail(input.email);
  if (!isValidEmail(email)) throw new Error("Invalid email");
  const emailHash = hashEmail(email);
  const occurredAt = input.occurredAt ?? new Date();
  const contactSource = input.source === "ticket_purchase" ? "event" : "subscribe";

  await transaction(async (client) => {
    // Ticket fulfilment can be retried after the ticket transaction commits.
    // Do not replay an old grant over a later unsubscribe.
    if (input.sourceRef) {
      const existing = await client.query<{ email_hash: string }>(
        `select email_hash
           from communication_contact_consent_events
          where source = $1 and source_ref = $2 and decision = 'granted'
          limit 1`,
        [input.source, input.sourceRef],
      );
      if (existing.rows.length > 0) return;
    }

    await client.query(
      `insert into communication_contacts
         (email_hash, email, display_name, sources, marketing_opted_in, opted_in_at,
          opted_out_at, unsubscribe_token)
       values ($1,$2,$3,array[$4]::text[],true,$5,null,$6)
       on conflict (email_hash) do update
         set email = excluded.email,
             display_name = coalesce(nullif(excluded.display_name, ''), communication_contacts.display_name),
             sources = (
               select array_agg(distinct source_value order by source_value)
                 from unnest(communication_contacts.sources || excluded.sources) as source_value
             ),
             marketing_opted_in = true,
             opted_in_at = excluded.opted_in_at,
             opted_out_at = null,
             updated_at = now()`,
      [
        emailHash,
        email,
        input.displayName?.trim().slice(0, 120) || null,
        contactSource,
        occurredAt,
        randomUUID(),
      ],
    );

    await insertConsentEvent(client, {
      emailHash,
      decision: "granted",
      source: input.source,
      sourceRef: input.sourceRef,
      consentVersion: input.consentVersion,
      privacyVersion: input.privacyVersion,
      occurredAt,
    });
  });
}

export async function setMarketingPreference(emailHash: string, optedIn: boolean): Promise<void> {
  assertEmailHash(emailHash);
  const occurredAt = new Date();

  await transaction(async (client) => {
    const result = await client.query<{ email_hash: string }>(
      `update communication_contacts
          set marketing_opted_in = $2,
              opted_in_at = case when $2 then $3 else opted_in_at end,
              opted_out_at = case when $2 then null else $3 end,
              updated_at = now()
        where email_hash = $1
        returning email_hash`,
      [emailHash, optedIn, occurredAt],
    );
    if (result.rows.length !== 1) throw new Error("Contact not found");

    await insertConsentEvent(client, {
      emailHash,
      decision: optedIn ? "granted" : "withdrawn",
      source: "admin",
      consentVersion: ADMIN_MARKETING_CONSENT_VERSION,
      privacyVersion: MARKETING_PRIVACY_NOTICE_VERSION,
      occurredAt,
    });
  });
}

export async function optOutByToken(token: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(token)) return false;
  const occurredAt = new Date();

  return transaction(async (client) => {
    const result = await client.query<{ email_hash: string }>(
      `update communication_contacts
          set marketing_opted_in = false, opted_out_at = $2, updated_at = now()
        where unsubscribe_token = $1
        returning email_hash`,
      [token, occurredAt],
    );
    const emailHash = result.rows[0]?.email_hash;
    if (!emailHash) return false;

    await insertConsentEvent(client, {
      emailHash,
      decision: "withdrawn",
      source: "unsubscribe",
      sourceRef: token,
      consentVersion: MARKETING_CONSENT_VERSION,
      privacyVersion: MARKETING_PRIVACY_NOTICE_VERSION,
      occurredAt,
    });
    return true;
  });
}
