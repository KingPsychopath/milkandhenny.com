"use client";

import { useEffect, useMemo, useState } from "react";

import { formatMoney } from "@/features/events/types";
import {
  beginOwnTicketExchangeFn,
  getTicketExchangeManagementFn,
  getTicketExchangeOutcomeFn,
} from "../exchange.functions";
import type { TicketExchangeManagement } from "../exchange-types";

type State = "closed" | "loading" | "choosing" | "confirming" | "working" | "done" | "error";

export function ManageTickets({
  managerTicketId,
  disabledReason,
}: {
  managerTicketId: string;
  disabledReason?: string;
}) {
  const [state, setState] = useState<State>("closed");
  const [management, setManagement] = useState<TicketExchangeManagement | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [targetTypeId, setTargetTypeId] = useState("");
  const [message, setMessage] = useState("");

  const selectedTicket = management?.tickets.find((ticket) => ticket.id === ticketId);
  const selectedType = management?.options.find((option) => option.id === targetTypeId);
  const amountDelta =
    selectedTicket && selectedType ? selectedType.priceMinor - selectedTicket.amountPaidMinor : 0;

  const actionLabel = useMemo(() => {
    if (!selectedType) return "review change";
    if (amountDelta < 0)
      return `review ${formatMoney(Math.abs(amountDelta), selectedType.currency)} refund`;
    if (amountDelta > 0) return `review ${formatMoney(amountDelta, selectedType.currency)} payment`;
    return "review free change";
  }, [amountDelta, selectedType]);

  const load = async () => {
    setState("loading");
    try {
      const result = await getTicketExchangeManagementFn({ data: { managerTicketId } });
      if (!result.ok) {
        setMessage(result.error);
        setState("error");
        return;
      }
      setManagement(result.management);
      const first = result.management.tickets.find(
        (ticket) => ticket.status === "valid" && !ticket.redeemed && !ticket.activeExchange,
      );
      setTicketId(first?.id ?? "");
      setTargetTypeId("");
      setState("choosing");
    } catch {
      setMessage("Ticket management could not be loaded. Try again.");
      setState("error");
    }
  };

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const exchangeId = search.get("exchange");
    const sessionId = search.get("session") ?? undefined;
    if (!exchangeId || exchangeId === "cancelled") return;
    setState("working");
    void getTicketExchangeOutcomeFn({ data: { exchangeId, sessionId } })
      .then((outcome) => {
        if (outcome.state === "complete") {
          setMessage(outcome.message);
          setState("done");
          window.history.replaceState({}, "", window.location.pathname);
          return;
        }
        if (outcome.state === "pending") {
          setMessage(outcome.message);
          setState("done");
          return;
        }
        setMessage(
          outcome.state === "failed"
            ? outcome.message
            : "That ticket change could not be found. No ticket was changed.",
        );
        setState("error");
      })
      .catch(() => {
        setMessage("We could not confirm the ticket change yet. Refresh this page in a moment.");
        setState("error");
      });
  }, []);

  if (state === "closed") {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => void load()}
          disabled={Boolean(disabledReason)}
          className="min-h-11 font-mono text-xs underline transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
        >
          manage tickets
        </button>
        {disabledReason && (
          <p className="mt-1 font-mono text-micro theme-muted leading-relaxed">{disabledReason}</p>
        )}
      </div>
    );
  }

  if (state === "loading" || state === "working") {
    return (
      <p role="status" className="text-center font-mono text-micro theme-muted">
        {state === "loading" ? "loading ticket options…" : "confirming your ticket change…"}
      </p>
    );
  }

  if (state === "done") {
    return (
      <div className="text-center">
        <p role="status" className="font-mono text-micro theme-subtle leading-relaxed">
          {message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 min-h-11 font-mono text-micro underline hover:opacity-70"
        >
          refresh tickets
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="text-center">
        <p role="alert" className="font-mono text-micro theme-subtle leading-relaxed">
          {message}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 min-h-11 font-mono text-micro underline hover:opacity-70"
        >
          try again
        </button>
      </div>
    );
  }

  if (!management) return null;

  const eligibleOptions = selectedTicket
    ? management.options.filter(
        (option) =>
          option.id !== selectedTicket.ticketTypeId && option.currency === selectedTicket.currency,
      )
    : [];

  if (state === "confirming" && selectedTicket && selectedType) {
    const consequence =
      amountDelta < 0
        ? `${formatMoney(Math.abs(amountDelta), selectedType.currency)} will return to the original payment method.`
        : amountDelta > 0
          ? `Stripe Checkout will collect ${formatMoney(amountDelta, selectedType.currency)}. The ticket changes only after payment succeeds.`
          : "There is no charge or refund for this change.";
    const submit = async () => {
      setState("working");
      try {
        const result = await beginOwnTicketExchangeFn({
          data: { managerTicketId, ticketId, targetTicketTypeId: selectedType.id },
        });
        if (!result.ok) {
          setMessage(result.error);
          setState("error");
          return;
        }
        if (result.state === "checkout" && result.url) {
          window.location.assign(result.url);
          return;
        }
        setMessage(result.message ?? "Ticket changed.");
        setState("done");
      } catch {
        setMessage("The ticket change did not complete. Try again.");
        setState("error");
      }
    };
    return (
      <section aria-labelledby="exchange-confirm-title" className="border-t theme-border pt-5">
        <h3 id="exchange-confirm-title" className="font-serif text-lg">
          Confirm ticket change
        </h3>
        <p className="mt-2 font-mono text-xs leading-relaxed">
          {selectedTicket.holderName}: {selectedTicket.ticketTypeName} → {selectedType.name}
        </p>
        <p className="mt-2 font-mono text-micro theme-subtle leading-relaxed">{consequence}</p>
        <p className="mt-2 font-mono text-micro theme-muted leading-relaxed">
          The ticket link and QR stay the same. Other tickets in this order are unchanged.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            className="min-h-11 rounded-lg bg-foreground px-4 font-mono text-xs text-background"
          >
            {amountDelta > 0 ? "continue to Stripe" : "confirm change"}
          </button>
          <button
            type="button"
            onClick={() => setState("choosing")}
            className="min-h-11 px-3 font-mono text-xs theme-muted underline hover:opacity-70"
          >
            go back
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="manage-tickets-title" className="border-t theme-border pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 id="manage-tickets-title" className="font-serif text-lg">
          Manage tickets
        </h3>
        <button
          type="button"
          onClick={() => setState("closed")}
          className="min-h-11 font-mono text-micro theme-muted underline hover:opacity-70"
        >
          close
        </button>
      </div>
      <p className="mt-1 font-mono text-micro theme-muted leading-relaxed">
        Change one ticket at a time. Names, links and QR codes stay as they are.
      </p>

      {management.tickets
        .filter((ticket) => ticket.activeExchange)
        .map((ticket) => (
          <p
            key={ticket.id}
            role={ticket.activeExchange?.errorMessage ? "alert" : "status"}
            className="mt-3 rounded-lg border theme-border px-3 py-2 font-mono text-micro theme-subtle leading-relaxed"
          >
            {ticket.holderName}: {ticket.activeExchange?.errorMessage ?? "ticket change pending"}.
          </p>
        ))}

      {selectedTicket ? (
        <>
          <label className="mt-5 block font-mono text-micro theme-muted" htmlFor="exchange-ticket">
            ticket
          </label>
          <select
            id="exchange-ticket"
            value={ticketId}
            onChange={(event) => {
              setTicketId(event.target.value);
              setTargetTypeId("");
            }}
            className="mt-1 min-h-11 w-full rounded-lg border theme-border-strong bg-background px-3 font-mono text-xs"
          >
            {management.tickets.map((ticket) => (
              <option
                key={ticket.id}
                value={ticket.id}
                disabled={
                  ticket.status !== "valid" || ticket.redeemed || Boolean(ticket.activeExchange)
                }
              >
                {ticket.holderName} — {ticket.ticketTypeName}
                {ticket.activeExchange
                  ? " (change pending)"
                  : ticket.redeemed
                    ? " (checked in)"
                    : ""}
              </option>
            ))}
          </select>

          <label className="mt-4 block font-mono text-micro theme-muted" htmlFor="exchange-type">
            change to
          </label>
          <select
            id="exchange-type"
            value={targetTypeId}
            onChange={(event) => setTargetTypeId(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border theme-border-strong bg-background px-3 font-mono text-xs"
          >
            <option value="">choose a ticket type</option>
            {eligibleOptions.map((option) => (
              <option key={option.id} value={option.id} disabled={!option.available}>
                {option.name} — {formatMoney(option.priceMinor, option.currency)}
                {!option.available
                  ? option.unavailableReason === "sold-out"
                    ? " (sold out)"
                    : " (not on sale)"
                  : ""}
              </option>
            ))}
          </select>

          {selectedType && (
            <p className="mt-3 font-mono text-micro theme-subtle leading-relaxed">
              {amountDelta < 0
                ? `${formatMoney(Math.abs(amountDelta), selectedType.currency)} refund`
                : amountDelta > 0
                  ? `${formatMoney(amountDelta, selectedType.currency)} to pay`
                  : "no price difference"}
            </p>
          )}
          <button
            type="button"
            disabled={!selectedType || !selectedType.available}
            onClick={() => setState("confirming")}
            className="mt-4 min-h-11 rounded-lg border theme-border-strong px-4 font-mono text-xs disabled:opacity-50"
          >
            {actionLabel}
          </button>
        </>
      ) : (
        <p role="status" className="mt-4 font-mono text-micro theme-muted leading-relaxed">
          There are no other tickets available to change right now.
        </p>
      )}
    </section>
  );
}
