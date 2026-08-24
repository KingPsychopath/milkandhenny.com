import { createFileRoute } from "@tanstack/react-router";
import { recordMarketingConsent } from "@/features/communications/marketing-consent.server";
import {
  MARKETING_CONSENT_VERSION,
  MARKETING_PRIVACY_NOTICE_VERSION,
} from "@/features/communications/marketing-consent";

async function handlePOST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return Response.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    await recordMarketingConsent({
      email,
      displayName: name,
      source: "subscribe",
      consentVersion: MARKETING_CONSENT_VERSION,
      privacyVersion: MARKETING_PRIVACY_NOTICE_VERSION,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not save your subscription" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/marketing/subscribe")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
