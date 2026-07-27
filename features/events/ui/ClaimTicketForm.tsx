"use client";

import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";

import { claimFreeTicketsFn } from "@/features/tickets/tickets.functions";
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
  | { status: "done"; ticketIds: string[]; emailed: boolean; emailError?: string }
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
}: {
  eventSlug: string;
  availability: TicketTypeAvailability;
}) {
  const nameId = useId();
  const emailId = useId();
  const errorId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<ClaimState>({ status: "idle" });

  const unavailable = salesMessage(availability);
  const maxQuantity = Math.min(
    availability.type.perPersonLimit,
    Math.max(1, availability.remaining),
  );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      const result = await claimFreeTicketsFn({
        data: {
          eventSlug,
          ticketTypeId: availability.type.id,
          holderName: name,
          email,
          quantity,
        },
      });

      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }

      setState({
        status: "done",
        ticketIds: result.ticketIds,
        emailed: result.emailed,
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
            {state.emailed
              ? "We've emailed it to you as well. Check spam if it's not there in a minute."
              : "We couldn't email it — save this link or screenshot the QR on the next page."}
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
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 w-full min-h-12 font-mono text-sm bg-foreground text-background rounded-lg hover-scale-slight transition-transform"
        >
          get ticket
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label htmlFor={nameId} className="font-mono text-micro theme-muted tracking-wide">
              your name
            </label>
            <input
              id={nameId}
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
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className="mt-1 w-full min-h-12 px-4 font-mono text-base bg-transparent border theme-border-strong rounded-lg text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
          </div>

          {maxQuantity > 1 && (
            <div>
              <label
                htmlFor={`${nameId}-qty`}
                className="font-mono text-micro theme-muted tracking-wide"
              >
                how many
              </label>
              <select
                id={`${nameId}-qty`}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                className="mt-1 w-full min-h-12 px-4 font-mono text-base bg-transparent border theme-border-strong rounded-lg text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
              >
                {Array.from({ length: maxQuantity }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}

          {state.status === "error" && (
            <p
              id={errorId}
              role="alert"
              className="font-mono text-xs text-[var(--things-country-outside)]"
            >
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={state.status === "submitting"}
            aria-describedby={state.status === "error" ? errorId : undefined}
            className="w-full min-h-12 font-mono text-sm bg-foreground text-background rounded-lg disabled:opacity-50 hover-scale-slight transition-transform"
          >
            {state.status === "submitting" ? "getting your ticket..." : "confirm"}
          </button>
        </form>
      )}
    </div>
  );
}
