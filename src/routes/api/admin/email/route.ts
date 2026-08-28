import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import {
  cancelQueuedEmail,
  cleanupEmailOperations,
  correctTicketRecipientAndResend,
  EmailOperationError,
  listEmailLedger,
  removeEmailSuppression,
  resendEmailFromLedger,
  retryEmailNow,
} from "@/features/email-operations/email-operations.server";
import type { EmailLedgerSort } from "@/features/email-operations/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { drainEmailOutbox } from "@/lib/platform/email-outbox.server";
import {
  isEmailChannel,
  isEmailDeliveryStatus,
  isEmailKind,
  isEmailOutboxStatus,
  isEmailSource,
} from "@/lib/shared/email-operations";
import { getBaseUrlForRequest } from "@/lib/shared/config";

const SORTS: EmailLedgerSort[] = ["newest", "oldest", "next-attempt"];

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const search = new URL(request.url).searchParams;
    const channel = search.get("channel");
    const status = search.get("status");
    const deliveryStatus = search.get("deliveryStatus");
    const kind = search.get("kind");
    const source = search.get("source");
    const sort = search.get("sort");
    return Response.json(
      await listEmailLedger({
        page: positiveInteger(search.get("page"), 1, 10_000),
        limit: positiveInteger(search.get("limit"), 40, 100),
        sort: SORTS.includes(sort as EmailLedgerSort) ? (sort as EmailLedgerSort) : "newest",
        query: search.get("q")?.trim() || undefined,
        eventSlug: search.get("eventSlug")?.trim() || undefined,
        channel: isEmailChannel(channel) ? channel : undefined,
        status: isEmailOutboxStatus(status) ? status : undefined,
        deliveryStatus: isEmailDeliveryStatus(deliveryStatus) ? deliveryStatus : undefined,
        kind: isEmailKind(kind) ? kind : undefined,
        source: isEmailSource(source) ? source : undefined,
      }),
    );
  } catch (error) {
    return apiErrorFromRequest(request, "admin.email.list", "Could not load email history", error);
  }
}

async function handlePOST(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";
  try {
    if (action === "drain") {
      return Response.json({ ok: true, handled: await drainEmailOutbox() });
    }
    if (action === "cleanup" || action === "unsuppress" || action === "correct-and-resend") {
      const stepUpError = await requireAdminStepUp(request);
      if (stepUpError) return stepUpError;
    }
    if (action === "cleanup") {
      return Response.json({ ok: true, ...(await cleanupEmailOperations()) });
    }
    if (action === "unsuppress") {
      const recipientHash = typeof body.recipientHash === "string" ? body.recipientHash : "";
      if (!/^[a-f0-9]{64}$/.test(recipientHash)) {
        return Response.json({ error: "Choose a valid suppression" }, { status: 400 });
      }
      await removeEmailSuppression(recipientHash);
      return Response.json({ ok: true });
    }
    if (action === "correct-and-resend") {
      if (!/^[a-f0-9-]{36}$/.test(id)) {
        return Response.json({ error: "Choose an email ledger entry" }, { status: 400 });
      }
      const recipientEmail =
        typeof body.recipientEmail === "string" ? body.recipientEmail.trim() : "";
      const result = await correctTicketRecipientAndResend(
        id,
        recipientEmail,
        getBaseUrlForRequest(request),
      );
      return Response.json({ ok: true, ...result });
    }
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      return Response.json({ error: "Choose an email ledger entry" }, { status: 400 });
    }
    if (action === "retry") await retryEmailNow(id);
    else if (action === "cancel") await cancelQueuedEmail(id);
    else if (action === "resend") {
      const result = await resendEmailFromLedger(id, getBaseUrlForRequest(request));
      return Response.json({ ok: true, ...result });
    } else return Response.json({ error: "Choose a valid email action" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof EmailOperationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return apiErrorFromRequest(request, "admin.email.action", "Email action failed", error, {
      action,
      id: id || undefined,
    });
  }
}

export const Route = createFileRoute("/api/admin/email")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
