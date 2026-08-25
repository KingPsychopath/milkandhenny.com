import { createFileRoute } from "@tanstack/react-router";
import { getClientIp } from "@/features/auth/auth.server";
import { recordMarketingConsent } from "@/features/communications/marketing-consent.server";
import {
  MARKETING_CONSENT_VERSION,
  MARKETING_PRIVACY_NOTICE_VERSION,
} from "@/features/communications/marketing-consent";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";

async function handlePOST(request: Request) {
  // Consent records are written for whatever address arrives, so the only
  // thing standing between the list and a script feeding it strangers'
  // addresses is this window.
  const limit = await reserveRateLimit({
    name: "marketing-subscribe",
    identity: getClientIp(request),
    limit: 5,
    windowSeconds: 3600,
    globalLimit: 200,
  });
  if (!limit.allowed) {
    return Response.json(
      { error: "Too many subscription attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds || 3600) } },
    );
  }

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
