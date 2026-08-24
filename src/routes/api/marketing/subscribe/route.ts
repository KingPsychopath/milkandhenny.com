import { createHash, randomUUID } from "node:crypto";

import { createFileRoute } from "@tanstack/react-router";
import { query } from "@/lib/platform/postgres.server";

function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function handlePOST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    await query(
      `insert into communication_contacts
         (email_hash, email, display_name, sources, marketing_opted_in, opted_in_at, opted_out_at, unsubscribe_token)
       values ($1,$2,$3,array['subscribe'],true,now(),null,$4)
       on conflict (email_hash) do update
         set email = excluded.email,
             display_name = coalesce(excluded.display_name, communication_contacts.display_name),
             marketing_opted_in = true,
             opted_in_at = now(),
             opted_out_at = null,
             updated_at = now()`,
      [emailHash(email), email, name, randomUUID()],
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not save your subscription" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/marketing/subscribe")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
