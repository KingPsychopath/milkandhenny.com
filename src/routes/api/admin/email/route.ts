import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { CommunicationsService } from "@/features/communications/communications-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import {
  EmailOperationError,
  listEmailLedger,
} from "@/features/email-operations/email-operations.server";
import type { EmailLedgerSort } from "@/features/email-operations/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  isEmailChannel,
  isEmailDeliveryStatus,
  isEmailKind,
  isEmailOutboxStatus,
  isEmailSource,
} from "@/lib/shared/email-operations";
import { getBaseUrlForRequest } from "@/lib/shared/config";

const SORTS: EmailLedgerSort[] = ["newest", "oldest", "next-attempt"];

function runCommunication<A>(
  request: Request,
  use: (service: typeof CommunicationsService.Service) => Effect.Effect<A, unknown>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* CommunicationsService);
    }),
    request.signal,
  );
}

function emailOperationError(error: unknown): EmailOperationError | null {
  if (error instanceof EmailOperationError) return error;
  if (typeof error !== "object" || error === null || !("cause" in error)) return null;
  return error.cause instanceof EmailOperationError ? error.cause : null;
}

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
      const handled = await runCommunication(request, (service) => service.drain);
      return Response.json({ ok: true, handled });
    }
    if (
      action === "cleanup" ||
      action === "unsuppress" ||
      action === "correct-and-resend" ||
      action === "reveal-recipient"
    ) {
      const stepUpError = await requireAdminStepUp(request);
      if (stepUpError) return stepUpError;
    }
    if (action === "cleanup") {
      const result = await runCommunication(request, (service) => service.cleanupEmail);
      return Response.json({ ok: true, ...result });
    }
    if (action === "unsuppress") {
      const recipientHash = typeof body.recipientHash === "string" ? body.recipientHash : "";
      if (!/^[a-f0-9]{64}$/.test(recipientHash)) {
        return Response.json({ error: "Choose a valid suppression" }, { status: 400 });
      }
      await runCommunication(request, (service) => service.removeSuppression(recipientHash));
      return Response.json({ ok: true });
    }
    if (action === "correct-and-resend") {
      if (!/^[a-f0-9-]{36}$/.test(id)) {
        return Response.json({ error: "Choose an email ledger entry" }, { status: 400 });
      }
      const recipientEmail =
        typeof body.recipientEmail === "string" ? body.recipientEmail.trim() : "";
      const useSuggestedCorrection = body.useSuggestedCorrection === true;
      if (!recipientEmail && !useSuggestedCorrection) {
        return Response.json(
          { error: "Enter or choose a corrected email address" },
          { status: 400 },
        );
      }
      const result = await runCommunication(request, (service) =>
        service.correctTicketRecipient(
          id,
          useSuggestedCorrection ? null : recipientEmail,
          getBaseUrlForRequest(request),
        ),
      );
      return Response.json({ ok: true, ...result });
    }
    if (action === "reveal-recipient") {
      if (!/^[a-f0-9-]{36}$/.test(id)) {
        return Response.json({ error: "Choose an email ledger entry" }, { status: 400 });
      }
      return Response.json(
        {
          recipientEmail: await runCommunication(request, (service) => service.revealRecipient(id)),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      return Response.json({ error: "Choose an email ledger entry" }, { status: 400 });
    }
    if (action === "retry") {
      await runCommunication(request, (service) => service.retryEmail(id));
    } else if (action === "cancel") {
      await runCommunication(request, (service) => service.cancelEmail(id));
    } else if (action === "resend") {
      const result = await runCommunication(request, (service) =>
        service.resendEmail(id, getBaseUrlForRequest(request)),
      );
      return Response.json({ ok: true, ...result });
    } else return Response.json({ error: "Choose a valid email action" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    const domainError = emailOperationError(error);
    if (domainError) {
      return Response.json({ error: domainError.message }, { status: domainError.status });
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
