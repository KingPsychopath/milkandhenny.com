"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { CameraFeed } from "./CameraFeed";
import { checkpointScanFn, checkpointUndoFn } from "../scanner.functions";
import type { CheckpointDirectoryTicket } from "../scanner.functions";
import type { CheckpointRecord, CheckpointTicketView } from "../checkpoint-types";

/**
 * Checkpoint scanner — catering, merch, cloakroom.
 *
 * The person holding this phone is not staff and has had no training: every
 * verdict is a full-width colour, the numbers are huge, and the only
 * decisions on screen are "give them one more" and "undo".
 *
 * Online-only by design. A checkpoint mistake is a spare meal, not a
 * gate-crasher, so the offline machinery the door carries is not worth its
 * complexity here.
 */

type Verdict =
  | { kind: "idle" }
  | { kind: "ok"; ticket: CheckpointTicketView; consumed: number }
  | { kind: "spent"; ticket: CheckpointTicketView; lastUsedAt?: string }
  | { kind: "not-included"; ticket: CheckpointTicketView }
  | { kind: "rejected"; title: string; detail: string };

function verdictStyle(kind: Verdict["kind"]): string {
  switch (kind) {
    case "ok":
      return "bg-[var(--things-green)] text-black";
    case "spent":
    case "not-included":
      return "bg-[var(--things-amber)] text-black";
    case "rejected":
      return "bg-[var(--things-country-outside)] text-white";
    default:
      return "";
  }
}

export function CheckpointScanner({
  token,
  eventSlug,
  eventTitle,
  label,
  checkpoint,
  initialSummary,
  initialTickets,
}: {
  /** Scanner-link token; absent when staff open this from their own session. */
  token?: string;
  eventSlug: string;
  eventTitle: string;
  label: string;
  checkpoint: CheckpointRecord;
  initialSummary: { unitsUsed: number; ticketsServed: number };
  initialTickets: CheckpointDirectoryTicket[];
}) {
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const [summary, setSummary] = useState(initialSummary);
  const [tickets, setTickets] = useState(initialTickets);
  const [busy, setBusy] = useState(false);
  const [manualId, setManualId] = useState("");
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

  /** Dead phone or unreadable code: find them by name or reference instead. */
  const matches = useMemo(() => {
    const term = manualId.trim().toLowerCase();
    if (term.length < 2) return [];
    return tickets
      .filter(
        (ticket) =>
          ticket.holderName.toLowerCase().includes(term) ||
          ticket.id.toLowerCase().startsWith(term),
      )
      .slice(0, 6);
  }, [manualId, tickets]);

  /** Keep the search list's used counts honest after scans and undos. */
  const applyUsed = useCallback((ticketId: string, used: number) => {
    setTickets((current) =>
      current.map((entry) => (entry.id === ticketId ? { ...entry, used } : entry)),
    );
  }, []);

  const scan = useCallback(
    async (raw: string, consume: number, bypassDebounce = false) => {
      const now = Date.now();
      if (
        !bypassDebounce &&
        lastScanRef.current &&
        lastScanRef.current.value === raw &&
        now - lastScanRef.current.at < 2_500
      ) {
        return;
      }
      lastScanRef.current = { value: raw, at: now };

      setBusy(true);
      try {
        const result = await checkpointScanFn({
          data: {
            token,
            eventSlug,
            checkpointId: checkpoint.id,
            scanned: raw,
            consume,
          },
        });

        if (!result.authorised) {
          setVerdict({
            kind: "rejected",
            title: "Link no longer active",
            detail: "This scanner link was turned off — ask the organiser for a fresh one.",
          });
          return;
        }

        const outcome = result.outcome;
        if ("ticket" in outcome && outcome.ticket) {
          applyUsed(outcome.ticket.ticketId, outcome.ticket.used);
        }
        switch (outcome.result) {
          case "consumed":
            setVerdict({ kind: "ok", ticket: outcome.ticket, consumed: outcome.consumed });
            if (outcome.consumed > 0) {
              setSummary((prev) => ({
                unitsUsed: prev.unitsUsed + outcome.consumed,
                ticketsServed:
                  outcome.ticket.used === outcome.consumed
                    ? prev.ticketsServed + 1
                    : prev.ticketsServed,
              }));
            }
            break;
          case "exhausted":
            setVerdict({ kind: "spent", ticket: outcome.ticket, lastUsedAt: outcome.lastUsedAt });
            break;
          case "not-included":
            setVerdict({ kind: "not-included", ticket: outcome.ticket });
            break;
          case "over-remaining":
            setVerdict({
              kind: "rejected",
              title: "Not enough left",
              detail: `${outcome.ticket.holderName} has ${Math.max(0, outcome.ticket.allowance - outcome.ticket.used)} of ${outcome.ticket.allowance} left here.`,
            });
            break;
          case "void":
            setVerdict({
              kind: "rejected",
              title: "Not valid",
              detail: "This ticket was cancelled or refunded.",
            });
            break;
          case "wrong-event":
            setVerdict({
              kind: "rejected",
              title: "Wrong event",
              detail: "That ticket is for a different night.",
            });
            break;
          case "unknown-checkpoint":
            setVerdict({
              kind: "rejected",
              title: "Station removed",
              detail: "This checkpoint no longer exists — ask the organiser.",
            });
            break;
          case "not-found":
            setVerdict({
              kind: "rejected",
              title: "No ticket",
              detail: "Nothing matches that code.",
            });
            break;
          default:
            setVerdict({
              kind: "rejected",
              title: "Not a ticket",
              detail: "That code isn't ours.",
            });
        }
      } catch {
        setVerdict({
          kind: "rejected",
          title: "No signal",
          detail: "Couldn't reach the server — try again in a moment.",
        });
      } finally {
        setBusy(false);
      }
    },
    [applyUsed, checkpoint.id, eventSlug, token],
  );

  const undo = useCallback(
    async (ticketId: string) => {
      setBusy(true);
      try {
        const result = await checkpointUndoFn({
          data: { token, eventSlug, checkpointId: checkpoint.id, ticketId },
        });
        if (result.authorised && result.ok) {
          setSummary((prev) => ({ ...prev, unitsUsed: Math.max(0, prev.unitsUsed - 1) }));
          applyUsed(ticketId, result.used);
          setVerdict((prev) =>
            prev.kind === "ok" && prev.ticket.ticketId === ticketId
              ? {
                  kind: "ok",
                  ticket: { ...prev.ticket, used: result.used },
                  consumed: 0,
                }
              : prev,
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [applyUsed, checkpoint.id, eventSlug, token],
  );

  const activeTicket =
    verdict.kind === "ok" || verdict.kind === "spent" || verdict.kind === "not-included"
      ? verdict.ticket
      : null;
  const remaining = activeTicket ? Math.max(0, activeTicket.allowance - activeTicket.used) : 0;

  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="mx-auto max-w-md px-5 pb-16 pt-8">
        <header className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-sm text-foreground">{checkpoint.name}</h1>
            <p className="truncate font-mono text-micro theme-muted">
              {eventTitle} · {label}
            </p>
          </div>
          <p className="shrink-0 font-mono text-micro theme-muted">{summary.unitsUsed} given out</p>
        </header>

        {/* Verdict above the camera — it is what the scanner actually reads. */}
        <div
          aria-live="assertive"
          className={`mt-4 min-h-28 rounded-2xl px-4 py-4 text-center ${
            verdict.kind === "idle" ? "border theme-border" : verdictStyle(verdict.kind)
          }`}
        >
          {verdict.kind === "idle" ? (
            <p className="pt-7 font-mono text-xs theme-muted">ready</p>
          ) : verdict.kind === "rejected" ? (
            <>
              <p className="font-mono text-lg font-bold">{verdict.title}</p>
              <p className="mt-1 font-mono text-xs opacity-90">{verdict.detail}</p>
            </>
          ) : (
            <>
              <p className="font-serif text-2xl font-bold leading-tight">
                {verdict.ticket.holderName}
              </p>
              <p className="mt-1 font-mono text-xs opacity-90">
                {verdict.kind === "ok" &&
                  (verdict.consumed > 0
                    ? `✓ ${verdict.consumed} ${checkpoint.name.toLowerCase()} — ${remaining} of ${verdict.ticket.allowance} left`
                    : `${remaining} of ${verdict.ticket.allowance} left`)}
                {verdict.kind === "spent" &&
                  `All ${verdict.ticket.allowance} already used${
                    verdict.lastUsedAt
                      ? ` · last at ${new Date(verdict.lastUsedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                      : ""
                  }`}
                {verdict.kind === "not-included" &&
                  `${verdict.ticket.ticketTypeName} doesn't include this`}
              </p>
            </>
          )}
        </div>

        {/* Follow-up actions for the ticket on screen: one more, or undo. */}
        {activeTicket && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || remaining === 0}
              onClick={() => void scan(activeTicket.ticketId, 1, true)}
              className="min-h-12 rounded-lg bg-foreground px-4 font-mono text-xs text-background disabled:opacity-40"
            >
              {remaining === 0 ? "none left" : `give 1 more (${remaining} left)`}
            </button>
            <button
              type="button"
              disabled={busy || activeTicket.used === 0}
              onClick={() => void undo(activeTicket.ticketId)}
              className="min-h-12 rounded-lg border theme-border-strong px-4 font-mono text-xs text-foreground disabled:opacity-40"
            >
              undo 1
            </button>
          </div>
        )}

        <div className="mt-4">
          <CameraFeed onCode={(raw) => void scan(raw, 1)} paused={busy} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (matches.length === 1) {
              void scan(matches[0].id, 1);
              setManualId("");
            } else if (manualId.trim().length === 16) {
              void scan(manualId.trim(), 1);
              setManualId("");
            }
          }}
          className="mt-5"
        >
          <label htmlFor="checkpoint-manual" className="sr-only">
            Name or ticket reference
          </label>
          <input
            id="checkpoint-manual"
            value={manualId}
            onChange={(event) => setManualId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="can't scan? type their name or ticket ref"
            className="min-h-12 w-full rounded-lg border theme-border-strong bg-transparent px-3 font-mono text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
        </form>

        {matches.length > 0 && (
          <ul className="mt-2 divide-y theme-border">
            {matches.map((ticket) => {
              const left = Math.max(0, ticket.allowance - ticket.used);
              return (
                <li key={ticket.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-foreground">
                      {ticket.holderName}
                    </p>
                    <p className="font-mono text-micro theme-muted">
                      {ticket.ticketTypeName} ·{" "}
                      {ticket.allowance === 0
                        ? "not included"
                        : `${left} of ${ticket.allowance} left`}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy || left === 0}
                    onClick={() => {
                      setManualId("");
                      void scan(ticket.id, 1, true);
                    }}
                    className="shrink-0 min-h-10 rounded-lg border theme-border-strong px-3 font-mono text-micro text-foreground disabled:opacity-40"
                  >
                    {ticket.allowance === 0 ? "n/a" : left === 0 ? "all used" : "give 1"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-center font-mono text-micro theme-faint">
          Scanning checks each ticket's {checkpoint.name.toLowerCase()} allowance — it doesn't
          affect entry at the door.
        </p>
      </main>
    </div>
  );
}
