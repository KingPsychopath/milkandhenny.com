import { createFileRoute } from "@tanstack/react-router";

import { recordEmailFeedback, verifyResendFeedback } from "@/lib/platform/email-feedback.server";
import { log } from "@/lib/platform/logger.server";

async function handlePOST(request: Request) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = verifyResendFeedback(await request.text(), { id, timestamp, signature });
  } catch {
    log.warn("email.feedback", "Resend webhook verification failed", {});
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!event) return Response.json({ received: true, ignored: true });

  try {
    await recordEmailFeedback(event);
    return Response.json({ received: true });
  } catch (error) {
    log.error("email.feedback", "Could not record email delivery feedback", {}, error);
    return Response.json({ error: "Feedback could not be recorded" }, { status: 503 });
  }
}

export const Route = createFileRoute("/api/email/webhook/resend")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});
