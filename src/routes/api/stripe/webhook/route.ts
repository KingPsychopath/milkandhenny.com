import { createFileRoute } from "@tanstack/react-router";

import { log } from "@/lib/platform/logger.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { constructWebhookEvent, isPaymentsConfigured } from "@/lib/platform/stripe.server";
import { fulfilCheckout } from "@/features/tickets/checkout.server";
import { markOrderRefunded } from "@/features/tickets/store.server";

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
  "charge.refunded",
  "charge.dispute.created",
]);

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

  const origin = getBaseUrlForRequest(request);

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as { id: string };
        const result = await fulfilCheckout(session.id, origin);
        log.info("stripe.webhook", "Checkout handled", {
          sessionId: session.id,
          outcome: result.outcome,
        });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as {
          payment_intent: string | null;
          id: string;
        };
        if (charge.payment_intent) {
          // Covers refunds started from the Stripe dashboard as well as ours,
          // so a ticket always stops working when the money goes back.
          const voided = await markOrderRefunded(charge.payment_intent, charge.id);
          log.info("stripe.webhook", "Refund applied", {
            paymentIntent: charge.payment_intent,
            tickets: voided.length,
          });
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as { payment_intent: string | null; id: string };
        if (dispute.payment_intent) {
          const voided = await markOrderRefunded(dispute.payment_intent, dispute.id);
          // Loud on purpose: a dispute needs a human, and the door record is
          // the evidence if it is worth contesting.
          log.error("stripe.webhook", "Chargeback opened; tickets voided", {
            paymentIntent: dispute.payment_intent,
            disputeId: dispute.id,
            tickets: voided.length,
          });
        }
        break;
      }
    }
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
