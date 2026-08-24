"use client";

import { useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { TICKET_MARKETING_CONSENT_LABEL } from "@/features/communications/marketing-consent";
import {
  getCheckoutMinimumMinor,
  minimumCheckoutQuantity,
} from "@/features/tickets/payment-limits";
import { claimFreeTicketsFn, startCheckoutFn } from "@/features/tickets/tickets.functions";
import { useBrowserProfileForm } from "@/lib/client/browser-profile";
import { BrowserProfileHint } from "@/components/BrowserProfileHint";
import { formatMoney, type TicketType } from "../types";
import type { TicketTypeAvailability } from "../events.server";

/**
 * Free ticket claim.
 *
 * Deliberately two fields and one button. Paid checkout arrives in Phase 2
 * and will hand off to hosted Stripe Checkout from the same position on the
 * page, so the shape people learn here does not change under them.
 */

type ClaimState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; ticketIds: string[]; emailQueued: boolean; emailError?: string }
  | { status: "error"; message: string };

function salesMessage(availability: TicketTypeAvailability): string | null {
  switch (availability.sales.state) {
    case "on-sale":
      return null;
    case "sold-out":
      return "Sold out";
    case "cancelled":
      return "Cancelled";
    case "not-yet":
      return "Not on sale yet";
    case "closed":
      return "Sales closed";
    default:
      return "Unavailable";
  }
}

function TicketTypeHeading({ type, remaining }: { type: TicketType; remaining: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <h3 className="font-mono text-sm text-foreground">{type.name}</h3>
        {type.description && (
          <p className="mt-1 font-serif text-sm theme-subtle leading-relaxed">{type.description}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm text-foreground">
          {formatMoney(type.priceMinor, type.currency)}
        </p>
        {remaining > 0 && remaining <= 10 && (
          <p className="font-mono text-micro theme-muted mt-0.5">{remaining} left</p>
        )}
      </div>
    </div>
  );
}

export function ClaimTicketForm({
  eventSlug,
  availability,
  hasTicketTerms,
  hasRefundPolicy,
}: {
  eventSlug: string;
  availability: TicketTypeAvailability;
  hasTicketTerms: boolean;
  hasRefundPolicy: boolean;
}) {
  const nameId = useId();
  const emailId = useId();
  const marketingOptInId = useId();
  const marketingSupportId = useId();
  const errorId = useId();

  const [open, setOpen] = useState(false);
  const { name, email, setName, setEmail, remember } = useBrowserProfileForm();
  const [quantity, setQuantity] = useState(1);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const checkoutRequestId = useRef<string | null>(null);
  const [state, setState] = useState<ClaimState>({ status: "idle" });

  const unavailable = salesMessage(availability);
  const isPaid = availability.type.priceMinor > 0;
  const maxQuantity = Math.min(
    availability.type.perPersonLimit,
    Math.max(1, availability.remaining),
  );
  const minimumQuantity = isPaid
    ? minimumCheckoutQuantity(availability.type.priceMinor, availability.type.currency)
    : 1;
  const checkoutMinimum = getCheckoutMinimumMinor(availability.type.currency);
  const canStartOnlineCheckout = !isPaid || minimumQuantity <= maxQuantity;
  const quantityOptions = Array.from(
    { length: Math.max(0, maxQuantity - minimumQuantity + 1) },
    (_, index) => minimumQuantity + index,
  );
  const selectedQuantity = Math.min(maxQuantity, Math.max(minimumQuantity, quantity));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      // Paid tickets never issue from the browser — Stripe redirects here,
      // and the webhook is what actually creates the ticket after payment.
      if (isPaid) {
        checkoutRequestId.current ??= globalThis.crypto.randomUUID().replaceAll("-", "");
        const checkout = await startCheckoutFn({
          data: {
            eventSlug,
            ticketTypeId: availability.type.id,
            holderName: name,
            email,
            quantity: selectedQuantity,
            acceptedTerms,
            marketingOptIn,
            checkoutRequestId: checkoutRequestId.current,
          },
        });

        if (!checkout.ok) {
          setState({ status: "error", message: checkout.error });
          return;
        }

        remember({ name, email });
        window.location.assign(checkout.url);
        return;
      }

      const result = await claimFreeTicketsFn({
        data: {
          eventSlug,
          ticketTypeId: availability.type.id,
          holderName: name,
          email,
          quantity: selectedQuantity,
          marketingOptIn,
        },
      });

      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }

      remember({ name, email });
      setState({
        status: "done",
        ticketIds: result.ticketIds,
        emailQueued: result.emailQueued,
        emailError: result.emailError,
      });
    } catch {
      setState({ status: "error", message: "Something went wrong. Try again." });
    }
  };

  if (state.status === "done") {
    return (
      <div className="py-6 border-b theme-border">
        <TicketTypeHeading type={availability.type} remaining={availability.remaining} />
        <div className="mt-4 space-y-3">
          <p className="font-serif text-base text-foreground">
            You&apos;re in.{" "}
            {state.ticketIds.length > 1 ? `${state.ticketIds.length} tickets` : "Your ticket"}{" "}
            below.
          </p>
          <div className="space-y-2">
            {state.ticketIds.map((id, index) => (
              <Link
                key={id}
                to="/ticket/$id"
                params={{ id }}
                className="block w-full text-center font-mono text-sm py-3 border theme-border-strong rounded-lg text-foreground hover:opacity-70 transition-opacity"
              >
                open ticket {state.ticketIds.length > 1 ? index + 1 : ""} →
              </Link>
            ))}
          </div>
          <p className="font-mono text-micro theme-muted leading-relaxed">
            {state.emailQueued
              ? "Your email is queued. Check spam if it is not there in a minute."
              : "We could not queue the email. Save this link or screenshot the QR on the next page."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 border-b theme-border">
      <TicketTypeHeading type={availability.type} remaining={availability.remaining} />

      {unavailable ? (
        <p className="mt-4 font-mono text-xs theme-muted tracking-wide">{unavailable}</p>
      ) : !canStartOnlineCheckout ? (
        <p className="mt-4 font-mono text-xs theme-muted leading-relaxed">
          Online payments start at{" "}
          {checkoutMinimum
            ? formatMoney(checkoutMinimum, availability.type.currency)
            : "the card minimum"}
          . The remaining tickets cannot be bought online.
        </p>
      ) : !open ? (
        <button
          type="button"
          onClick={() => {
            setQuantity(minimumQuantity);
            setOpen(true);
          }}
          className="mt-4 w-full min-h-12 font-mono text-sm bg-foreground text-background rounded-lg hover-scale-slight transition-transform"
        >
          {isPaid ? "buy ticket" : "get ticket"}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label htmlFor={nameId} className="font-mono text-micro theme-muted tracking-wide">
              your name
            </label>
            <input
              id={nameId}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              maxLength={120}
              className="mt-1 w-full min-h-12 px-4 font-mono text-base bg-transparent border theme-border-strong rounded-lg text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
          </div>

          <div>
            <label htmlFor={emailId} className="font-mono text-micro theme-muted tracking-wide">
              email — we send the ticket here
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="mt-1 w-full min-h-12 px-4 font-mono text-base bg-transparent border theme-border-strong rounded-lg text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
          </div>

          <BrowserProfileHint />

          {quantityOptions.length > 1 && (
            <div>
              <label
                htmlFor={`${nameId}-qty`}
                className="font-mono text-micro theme-muted tracking-wide"
              >
                how many
              </label>
              <AppSelect
                id={`${nameId}-qty`}
                value={selectedQuantity}
                onValueChange={(value) => setQuantity(Number(value))}
                options={quantityOptions.map((value) => ({ value, label: String(value) }))}
                variant="field"
                className="mt-1"
              />
            </div>
          )}

          <div className="rounded-lg border theme-border px-3 py-3">
            <div className="flex items-start gap-3">
              <input
                id={marketingOptInId}
                type="checkbox"
                checked={marketingOptIn}
                onChange={(event) => setMarketingOptIn(event.target.checked)}
                aria-describedby={marketingSupportId}
                className="mt-0.5 size-4 shrink-0 accent-[var(--prose-hashtag)]"
              />
              <label
                htmlFor={marketingOptInId}
                className="font-mono text-micro theme-muted leading-relaxed"
              >
                {TICKET_MARKETING_CONSENT_LABEL}
              </label>
            </div>
            <p id={marketingSupportId} className="mt-2 pl-7 font-mono text-micro theme-faint">
              Optional. See the{" "}
              <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                privacy notice
              </Link>
              . Unsubscribe anytime.
            </p>
          </div>

          {state.status === "error" && (
            <p
              id={errorId}
              role="alert"
              className="font-mono text-xs text-[var(--things-country-outside)]"
            >
              {state.message}
            </p>
          )}

          {isPaid && (
            <label className="flex items-start gap-3 rounded-lg border theme-border px-3 py-3">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                required
                className="mt-0.5 size-4 accent-[var(--prose-hashtag)]"
              />
              <span className="font-mono text-micro theme-muted leading-relaxed">
                I agree to the{" "}
                <a href="#ticket-terms" className="underline hover:text-foreground">
                  {hasTicketTerms ? "ticket terms" : "entry terms"}
                </a>
                {hasRefundPolicy ? " and refund policy" : " and refund information"} shown on this
                page.
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={state.status === "submitting" || (isPaid && !acceptedTerms)}
            aria-describedby={state.status === "error" ? errorId : undefined}
            className="w-full min-h-12 font-mono text-sm bg-foreground text-background rounded-lg disabled:opacity-50 hover-scale-slight transition-transform"
          >
            {state.status === "submitting"
              ? isPaid
                ? "taking you to checkout..."
                : "getting your ticket..."
              : isPaid
                ? `pay ${formatMoney(
                    availability.type.priceMinor * selectedQuantity,
                    availability.type.currency,
                  )}`
                : "confirm"}
          </button>
        </form>
      )}
    </div>
  );
}
