import {
  cancelUnfulfilledCheckout,
  expireCheckout,
  fulfilCheckout,
  markUnfulfilledCheckoutDisputed,
  reconcilePaymentRefunds,
  reopenWonDisputeCheckout,
  updateAllocatedTicketRefund,
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
import { log } from "@/lib/platform/logger.server";
import { retrievePaymentMetadata } from "@/lib/platform/payment-provider-context.server";
import { constructWebhookEvent } from "@/lib/platform/stripe.server";

export type StripeWebhookEvent = ReturnType<typeof constructWebhookEvent>;

/** Idempotent Stripe event orchestration. Signature verification remains at the HTTP edge. */
export async function handleStripeWebhookEvent(
  event: StripeWebhookEvent,
  origin: string,
): Promise<void> {
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
      if (!(await expireTicketExchangeCheckout(session.id))) await expireCheckout(session.id);
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as {
        payment_intent: string | null;
        amount_refunded: number | null;
        metadata?: Record<string, string>;
      };
      if (!charge.payment_intent) break;
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
        amountRefundedMinor: Math.max(charge.amount_refunded ?? 0, reconciled.amountRefundedMinor),
      });
      log.info("stripe.webhook", "Refund applied", {
        paymentIntent: charge.payment_intent,
        amountRefunded: charge.amount_refunded,
        tickets: reconciled.tickets.length,
      });
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
      const allocated = await updateAllocatedTicketRefund(refund.id, refund.status);
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
      if (paymentIntentId && refund.status === "succeeded" && !allocated) {
        await reconcilePaymentRefunds(paymentIntentId);
      }
      if (refund.status === "failed" && !allocated) {
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
      if (!dispute.payment_intent || dispute.status !== "won") {
        log.info("stripe.webhook", "Dispute closed", {
          disputeId: dispute.id,
          status: dispute.status,
        });
        break;
      }
      if (await restoreExchangePaymentDispute(dispute.payment_intent, dispute.id)) {
        log.info("stripe.webhook", "Upgrade dispute won; ticket restored", {
          disputeId: dispute.id,
        });
        break;
      }
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
      break;
    }

    case "radar.early_fraud_warning.created": {
      const warning = event.data.object as { charge: string | null; id: string };
      log.error("stripe.webhook", "Early fraud warning — consider refunding proactively", {
        warningId: warning.id,
        charge: warning.charge,
      });
      break;
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as { payment_intent: string | null; id: string };
      if (!dispute.payment_intent) break;
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
      log.error("stripe.webhook", "Chargeback opened; tickets voided", {
        paymentIntent: dispute.payment_intent,
        disputeId: dispute.id,
        tickets: voided.length,
      });
      break;
    }
  }
}
