import { createHash, randomUUID } from "node:crypto";

import { sendEmail } from "@/lib/platform/email.server";
import { query } from "@/lib/platform/postgres.server";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { BASE_URL } from "@/lib/shared/config";

export async function sendPersonSecurityNotice(input: {
  personId: string;
  subject: string;
  message: string;
}): Promise<void> {
  try {
    const recipients = await query<{ email_address: string }>(
      `select distinct email_address
         from event_person_identifiers
        where person_id = $1 and kind = 'email' and verified_at is not null
          and historical_until is null and email_address is not null`,
      [input.personId],
    );
    if (recipients.length === 0) return;
    const eventId = randomUUID();
    await Promise.all(
      recipients.map(async ({ email_address: email }) => {
        const text = [
          input.subject,
          "",
          input.message,
          "",
          "If this was not you, use a saved passkey to secure your account and contact us.",
          "",
          "— milk & henny",
        ].join("\n");
        const html = renderBrandedEmail({
          origin: BASE_URL,
          label: "sign-in security",
          title: input.subject,
          contentHtml: `<p style="margin:0">${escapeEmailHtml(input.message)}</p>`,
          note: "If this was not you, use a saved passkey to secure your account and contact us.",
        });
        await sendEmail(
          { channel: "access", to: email, subject: input.subject, text, html },
          {
            idempotencyKey: `security-notice:${eventId}:${createHash("sha256").update(email).digest("hex")}`,
            kind: "security-notice",
            source: "system",
          },
        );
      }),
    );
  } catch {
    // A notification failure must not strand a completed credential change.
  }
}
