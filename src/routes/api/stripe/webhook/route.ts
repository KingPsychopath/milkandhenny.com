import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { EventOperationsService } from "@/features/event-operations/event-operations-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { log } from "@/lib/platform/logger.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { constructWebhookEvent, isPaymentsConfigured } from "@/lib/platform/stripe.server";

/**
 * Stripe webhook.
 *
 * This is the authoritative path for issuing paid tickets. The success
 * redirect is a courtesy; people close the tab, lose signal, or pay on a
 * phone that goes flat, and none of that should cost them a ticket.
 *
 * The signature is verified against the raw body — `request.text()`, never a
 * parsed-and-reserialised object, because re-serialising changes the bytes
 * and invalidates the signature.
 */

const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "radar.early_fraud_warning.created",
]);

function runOperation<A, E>(
  request: Request,
  use: (service: typeof EventOperationsService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* EventOperationsService);
    }),
    request.signal,
  );
}

async function handlePOST(request: Request) {
  if (!isPaymentsConfigured()) {
    return Response.json({ error: "Payments are not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await request.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch {
    // A bad signature is either a misconfigured secret or someone poking at
    // the endpoint. The reason is deliberately not logged or returned — it
    // would tell an attacker which part of their forgery was wrong.
    log.warn("stripe.webhook", "Signature verification failed", {});
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // 200 so Stripe stops retrying events we deliberately ignore.
    return Response.json({ received: true, ignored: event.type });
  }

  try {
    await runOperation(request, (operations) =>
      operations.handleStripeWebhook(event, getBaseUrlForRequest(request)),
    );
  } catch (error) {
    // 500 so Stripe retries with backoff. Handlers are idempotent, so a
    // retry after partial work is safe.
    log.error("stripe.webhook", "Handler failed", { type: event.type }, error);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
