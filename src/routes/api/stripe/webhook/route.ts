import { createFileRoute } from "@tanstack/react-router";

import { log } from "@/lib/platform/logger.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { constructWebhookEvent, isPaymentsConfigured } from "@/lib/platform/stripe.server";
import { expireCheckout, fulfilCheckout } from "@/features/tickets/checkout.server";
import { getEvent } from "@/features/events/store.server";
import { sendRefundEmail } from "@/features/tickets/email.server";
import {
  markOrderDisputed,
  markOrderRefunded,
  restoreDisputedTickets,
} from "@/features/tickets/store.server";

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
  "charge.dispute.created",
  "charge.dispute.closed",
  "radar.early_fraud_warning.created",
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

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as { id: string };
        // Nothing was issued, so this is bookkeeping only: it stops abandoned
        // or failed baskets sitting as `pending` forever. A delayed payment
        // method (bank debit) that later fails lands here too.
        await expireCheckout(session.id);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as {
          payment_intent: string | null;
          id: string;
          amount_refunded: number | null;
        };
        if (charge.payment_intent) {
          // Fires for partial refunds too, so the amount decides how many
          // tickets are voided. Covers dashboard-initiated refunds as well as
          // ours, so a ticket always stops working when the money goes back.
          const voided = await markOrderRefunded(
            charge.payment_intent,
            charge.id,
            charge.amount_refunded ?? undefined,
          );
          if (voided.length > 0) {
            const refundedEvent = await getEvent(voided[0].eventSlug);
            if (refundedEvent) await sendRefundEmail({ event: refundedEvent, tickets: voided });
          }
          log.info("stripe.webhook", "Refund applied", {
            paymentIntent: charge.payment_intent,
            amountRefunded: charge.amount_refunded,
            tickets: voided.length,
          });
        }
        break;
      }

      case "charge.dispute.closed": {
        const dispute = event.data.object as {
          payment_intent: string | null;
          id: string;
          status: string;
        };
        if (dispute.payment_intent && dispute.status === "won") {
          // The charge stands, so the ticket should too. Only reverses a
          // dispute-driven void — a real refund set `refunded_at` and stays put.
          const restored = await restoreDisputedTickets(dispute.payment_intent, dispute.id);
          log.info("stripe.webhook", "Dispute won; tickets restored", {
            disputeId: dispute.id,
            tickets: restored.length,
          });
        } else {
          log.info("stripe.webhook", "Dispute closed", {
            disputeId: dispute.id,
            status: dispute.status,
          });
        }
        break;
      }

      case "radar.early_fraud_warning.created": {
        const warning = event.data.object as { charge: string | null; id: string };
        // Stripe thinks this charge will be disputed. Refunding now avoids the
        // dispute fee entirely, but that is a judgement call, so this only
        // raises the flag loudly rather than acting on its own.
        log.error("stripe.webhook", "Early fraud warning — consider refunding proactively", {
          warningId: warning.id,
          charge: warning.charge,
        });
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object as { payment_intent: string | null; id: string };
        if (dispute.payment_intent) {
          const voided = await markOrderDisputed(dispute.payment_intent, dispute.id);
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
