import { createFileRoute } from "@tanstack/react-router";

import { log } from "@/lib/platform/logger.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import {
  constructWebhookEvent,
  isPaymentsConfigured,
  retrievePaymentMetadata,
} from "@/lib/platform/stripe.server";
import {
  cancelUnfulfilledCheckout,
  expireCheckout,
  fulfilCheckout,
  markUnfulfilledCheckoutDisputed,
  reconcilePaymentRefunds,
  reopenWonDisputeCheckout,
  updateCheckoutRefundStatus,
} from "@/features/tickets/checkout.server";
import {
  completePendingExchangeRefund,
  expireTicketExchangeCheckout,
  fulfilTicketExchangeCheckout,
  restoreExchangePaymentDispute,
  voidExchangePaymentDispute,
  voidExchangePaymentRefund,
} from "@/features/tickets/exchange.server";
import {
  markOrderDisputed,
  markRefundFailed,
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
  "refund.created",
  "refund.updated",
  "refund.failed",
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
        const exchange = await fulfilTicketExchangeCheckout(session.id, origin);
        if (exchange) {
          if (exchange.state === "failed" || exchange.state === "unknown") {
            throw new Error("Ticket exchange checkout could not be fulfilled");
          }
          log.info("stripe.webhook", "Ticket exchange checkout handled", {
            sessionId: session.id,
            outcome: exchange.state,
          });
          break;
        }
        const result = await fulfilCheckout(session.id, origin);
        log.info("stripe.webhook", "Checkout handled", {
          sessionId: session.id,
          outcome: result.outcome,
        });
        if (result.outcome === "failed" || result.outcome === "unknown-session") {
          throw new Error(
            result.outcome === "failed" ? result.error : "Checkout session is not in the ledger",
          );
        }
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as { id: string };
        if (await expireTicketExchangeCheckout(session.id)) break;
        // Nothing was issued, so this is bookkeeping only: it stops abandoned
        // or failed baskets sitting as `pending` forever. A delayed payment
        // method (bank debit) that later fails lands here too.
        await expireCheckout(session.id);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as {
          payment_intent: string | null;
          amount_refunded: number | null;
          metadata?: Record<string, string>;
        };
        if (charge.payment_intent) {
          if (
            await voidExchangePaymentRefund(
              charge.payment_intent,
              charge.metadata?.checkoutReference ?? charge.payment_intent,
            )
          ) {
            log.error("stripe.webhook", "Upgrade payment refunded; ticket voided", {
              paymentIntent: charge.payment_intent,
            });
            break;
          }
          const reconciled = await reconcilePaymentRefunds(
            charge.payment_intent,
            charge.amount_refunded ?? 0,
          );
          await cancelUnfulfilledCheckout({
            paymentIntentId: charge.payment_intent,
            reference: charge.metadata?.checkoutReference,
            amountRefundedMinor: Math.max(
              charge.amount_refunded ?? 0,
              reconciled.amountRefundedMinor,
            ),
          });
          log.info("stripe.webhook", "Refund applied", {
            paymentIntent: charge.payment_intent,
            amountRefunded: charge.amount_refunded,
            tickets: reconciled.tickets.length,
          });
        }
        break;
      }

      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = event.data.object as {
          id: string;
          status: string | null;
          payment_intent: string | { id: string } | null;
          metadata?: Record<string, string>;
        };
        const paymentIntentId =
          typeof refund.payment_intent === "string"
            ? refund.payment_intent
            : (refund.payment_intent?.id ?? null);
        await updateCheckoutRefundStatus(refund.id, refund.status);
        if (
          await completePendingExchangeRefund(
            refund.id,
            refund.status,
            origin,
            refund.metadata?.ticketExchangeId,
            refund.metadata?.ticketExchangePaymentRef,
          )
        )
          break;
        if (paymentIntentId && refund.status === "succeeded") {
          await reconcilePaymentRefunds(paymentIntentId);
        }
        if (refund.status === "failed") {
          const affected = await markRefundFailed(refund.id);
          log.error("stripe.webhook", "Refund failed; manual repayment is required", {
            refundId: refund.id,
            paymentIntent: paymentIntentId,
            tickets: affected.length,
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
          if (await restoreExchangePaymentDispute(dispute.payment_intent, dispute.id)) {
            log.info("stripe.webhook", "Upgrade dispute won; ticket restored", {
              disputeId: dispute.id,
            });
            break;
          }
          // The charge stands, so the ticket should too. Only reverses a
          // dispute-driven void — a real refund set `refunded_at` and stays put.
          const restored = await restoreDisputedTickets(dispute.payment_intent, dispute.id);
          log.info("stripe.webhook", "Dispute won; tickets restored", {
            disputeId: dispute.id,
            tickets: restored.length,
          });
          const sessionId = await reopenWonDisputeCheckout(dispute.payment_intent, dispute.id);
          if (sessionId) {
            const result = await fulfilCheckout(sessionId, origin);
            if (result.outcome === "failed" || result.outcome === "unknown-session") {
              throw new Error("Could not fulfil checkout after a won dispute");
            }
          }
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
          if (await voidExchangePaymentDispute(dispute.payment_intent, dispute.id)) {
            log.error("stripe.webhook", "Upgrade payment disputed; ticket voided", {
              paymentIntent: dispute.payment_intent,
              disputeId: dispute.id,
            });
            break;
          }
          const metadata = await retrievePaymentMetadata(dispute.payment_intent);
          await markUnfulfilledCheckoutDisputed({
            paymentIntentId: dispute.payment_intent,
            reference: metadata.checkoutReference,
            disputeId: dispute.id,
          });
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
