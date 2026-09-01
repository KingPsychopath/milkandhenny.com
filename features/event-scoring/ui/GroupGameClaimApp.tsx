import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import {
  ATTENDEE_CLAIMS_EVENT,
  attendeeClaimResultFromEvent,
  submitAttendeeClaim,
} from "../attendee-claims.client";

type Preview = {
  groupName: string;
  points: number;
  claimed: number;
  maximumClaims: number;
  expiresAt: number;
};

type Receipt = {
  groupName: string;
  pointsAwarded: number;
  previousBalance: number;
  balance: number;
};

function tokenFromFragment(eventSlug: string) {
  const storageKey = `milk-and-henny:group-game-claim:${eventSlug}`;
  const scanned = new URLSearchParams(consumeLocationFragment()).get("claim") ?? "";
  if (scanned) {
    sessionStorage.setItem(storageKey, scanned);
    return scanned;
  }
  return sessionStorage.getItem(storageKey) ?? "";
}

export function GroupGameClaimApp({
  eventSlug,
  activeParticipantId,
  tickets,
}: {
  eventSlug: string;
  activeParticipantId?: string;
  tickets: Array<{
    ticketId: string;
    participantId: string;
    holderName: string;
    active: boolean;
  }>;
}) {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [displayBalance, setDisplayBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ticketId, setTicketId] = useState(tickets.length === 1 ? tickets[0]!.ticketId : "");
  const animationRef = useRef<number | null>(null);
  const commandId = useRef(crypto.randomUUID());
  useEffect(() => {
    const nextToken = tokenFromFragment(eventSlug);
    setToken(nextToken);
    if (!nextToken) {
      setError("This claim link is missing its private code. Scan the team QR again.");
      setLoading(false);
      return;
    }
    void fetch(`/api/events/${encodeURIComponent(eventSlug)}/game-results/group-claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "preview", token: nextToken }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as Preview & { error?: string };
        if (!response.ok) throw new Error(body?.error ?? "This team claim is unavailable.");
        setPreview(body);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "This team claim is unavailable."),
      )
      .finally(() => setLoading(false));
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [eventSlug]);

  useEffect(() => {
    if (!pending) return;
    const settle = (event: Event) => {
      const detail = attendeeClaimResultFromEvent(event, commandId.current);
      if (!detail || detail.result.state === "pending") return;
      setPending(false);
      commandId.current = crypto.randomUUID();
      if (detail.result.state === "rejected") {
        setError(detail.result.error);
        return;
      }
      const body = detail.result.body;
      if (
        typeof body.groupName !== "string" ||
        typeof body.pointsAwarded !== "number" ||
        typeof body.previousBalance !== "number" ||
        typeof body.balance !== "number"
      ) {
        setError("The server confirmed the claim. Open your ticket to check the exact total.");
        return;
      }
      setReceipt({
        groupName: body.groupName,
        pointsAwarded: body.pointsAwarded,
        previousBalance: body.previousBalance,
        balance: body.balance,
      });
      setDisplayBalance(body.balance);
      setSettled(true);
    };
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, settle);
    return () => window.removeEventListener(ATTENDEE_CLAIMS_EVENT, settle);
  }, [pending]);

  const claim = async () => {
    if (!token || claiming) return;
    const activeTicket = tickets.find((ticket) => ticket.active);
    const selectedTicket = tickets.find((ticket) => ticket.ticketId === ticketId);
    const target =
      activeTicket ?? selectedTicket ?? (tickets.length === 1 ? tickets[0] : undefined);
    const participantId = activeParticipantId ?? target?.participantId;
    if (!participantId) {
      setError(
        tickets.length > 1
          ? "Choose the ticket receiving these points."
          : "Open your event ticket on this phone, then scan the team code again.",
      );
      return;
    }
    setClaiming(true);
    setError(null);
    setPending(false);
    try {
      const result = await submitAttendeeClaim({
        commandId: commandId.current,
        eventSlug,
        participantId,
        ticketId: target?.ticketId,
        url: `/api/events/${encodeURIComponent(eventSlug)}/game-results/group-claims`,
        label: "Team points claim",
        expiresAt: preview ? new Date(preview.expiresAt).toISOString() : undefined,
        body: { operation: "claim", token, ticketId: target?.ticketId },
      });
      if (result.state === "pending") {
        setPending(true);
        return;
      }
      if (result.state === "rejected") {
        commandId.current = crypto.randomUUID();
        throw new Error(result.error);
      }
      commandId.current = crypto.randomUUID();
      const body = result.body;
      if (
        typeof body.groupName !== "string" ||
        typeof body.pointsAwarded !== "number" ||
        typeof body.previousBalance !== "number" ||
        typeof body.balance !== "number"
      ) {
        throw new Error("The confirmed points receipt was incomplete. Open your ticket to check.");
      }
      const confirmed: Receipt = {
        groupName: body.groupName,
        pointsAwarded: body.pointsAwarded,
        previousBalance: body.previousBalance,
        balance: body.balance,
      };
      setReceipt(confirmed);
      setDisplayBalance(confirmed.previousBalance);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        setDisplayBalance(confirmed.balance);
        setSettled(true);
        navigator.vibrate?.(18);
        return;
      }
      const startedAt = performance.now();
      const duration = 1_100;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - (1 - progress) ** 4;
        setDisplayBalance(
          Math.round(
            confirmed.previousBalance + (confirmed.balance - confirmed.previousBalance) * eased,
          ),
        );
        if (progress < 1) animationRef.current = requestAnimationFrame(tick);
        else {
          setDisplayBalance(confirmed.balance);
          setSettled(true);
          navigator.vibrate?.([14, 35, 18]);
        }
      };
      animationRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those points could not be claimed.");
    } finally {
      setClaiming(false);
    }
  };
  return (
    <div className="min-h-[100dvh] bg-[var(--things-night)] text-white">
      <header className="flex items-center justify-between px-6 py-5 font-mono text-[11px] text-white/40">
        <span>Family Feud</span>
        <span>event points</span>
      </header>
      <main
        id="main"
        className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-2xl items-center justify-center px-6 pb-12 text-center"
      >
        {loading ? (
          <p className="font-mono text-sm text-white/45" aria-busy="true">
            checking team claim…
          </p>
        ) : receipt ? (
          <section className={`w-full ${settled ? "feud-claim-settled" : ""}`}>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
              {receipt.groupName} · claimed
            </p>
            <div className="relative mt-8">
              <p className="font-mono text-[clamp(5rem,25vw,11rem)] font-semibold leading-none tabular-nums tracking-[-0.08em]">
                {displayBalance}
              </p>
              {!settled ? (
                <span
                  aria-hidden="true"
                  className="feud-claim-plus absolute -top-3 right-[8%] rounded-full border border-[var(--things-amber)]/50 bg-[var(--things-night)] px-4 py-2 font-mono text-xl text-[var(--things-amber)]"
                >
                  +{receipt.pointsAwarded}
                </span>
              ) : null}
            </div>
            <div className="mx-auto mt-7 h-px max-w-sm bg-[var(--things-amber)]/65" />
            <p className="mt-5 font-serif text-3xl">Your points are in.</p>
            <p className="mt-3 text-white/50">
              +{receipt.pointsAwarded} from this Family Feud result · new total {receipt.balance}
            </p>
            <p className="sr-only" aria-live="polite">
              {settled
                ? `${receipt.pointsAwarded} points claimed. Your new total is ${receipt.balance}.`
                : ""}
            </p>
            <div className="mt-9 grid gap-3 sm:grid-cols-2">
              <Link
                to="/events/$slug/score"
                params={{ slug: eventSlug }}
                className="inline-flex min-h-14 items-center justify-center rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black"
              >
                view leaderboard
              </Link>
              <Link
                to="/events/$slug"
                params={{ slug: eventSlug }}
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/18 px-6 font-mono text-sm"
              >
                done
              </Link>
            </div>
          </section>
        ) : pending ? (
          <section className="max-w-lg" role="status">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
              confirmation pending
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold sm:text-5xl">
              Claim saved on this phone.
            </h1>
            <p className="mt-5 text-lg text-white/55">
              No total is being guessed. The same claim will retry until the server returns its
              definitive result.
            </p>
            {ticketId || tickets.find((ticket) => ticket.active)?.ticketId ? (
              <Link
                to="/ticket/$id"
                params={{ id: ticketId || tickets.find((ticket) => ticket.active)!.ticketId }}
                className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[var(--things-amber)] px-6 font-mono text-xs font-semibold text-black"
              >
                open ticket &amp; points
              </Link>
            ) : null}
          </section>
        ) : error ? (
          <section className="max-w-lg">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
              claim unavailable
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold sm:text-5xl">
              Nothing was added.
            </h1>
            <p className="mt-5 text-lg text-white/55">{error}</p>
            <p className="mt-5 text-sm text-white/40">
              If you have not opened your ticket on this phone, do that first and then scan the team
              QR again.
            </p>
            <Link
              to="/events/$slug"
              params={{ slug: eventSlug }}
              className="mt-8 inline-flex min-h-12 items-center rounded-full border border-white/18 px-6 font-mono text-xs"
            >
              back to event
            </Link>
          </section>
        ) : preview ? (
          <section className="w-full max-w-lg">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
              {preview.groupName}
            </p>
            <h1 className="mt-5 font-serif text-5xl font-semibold sm:text-6xl">
              Claim +{preview.points}
            </h1>
            <p className="mt-5 text-lg text-white/55">
              Only continue if you played on this team in the match that just finished.
            </p>
            {!activeParticipantId && tickets.length > 1 ? (
              <label className="mt-7 block text-left font-mono text-xs text-white/65">
                ticket receiving the points
                <AppSelect
                  value={ticketId}
                  onValueChange={setTicketId}
                  options={[
                    { value: "", label: "choose a ticket" },
                    ...tickets.map((ticket) => ({
                      value: ticket.ticketId,
                      label: ticket.holderName,
                    })),
                  ]}
                  variant="field"
                  ariaLabel="Ticket receiving the points"
                  className="mt-2"
                />
              </label>
            ) : null}
            <div className="mt-7 flex justify-center gap-3 font-mono text-xs text-white/40">
              <span>
                {preview.claimed}/{preview.maximumClaims} claimed
              </span>
              <span>·</span>
              <span>one claim per player</span>
            </div>
            <button
              type="button"
              disabled={claiming || (!activeParticipantId && tickets.length > 1 && !ticketId)}
              onClick={() => void claim()}
              className="mt-9 min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black disabled:opacity-45"
            >
              {claiming ? "adding points…" : `claim ${preview.points} points`}
            </button>
            <Link
              to="/events/$slug"
              params={{ slug: eventSlug }}
              className="mt-4 inline-flex min-h-11 items-center font-mono text-xs text-white/35"
            >
              not my team
            </Link>
          </section>
        ) : null}
      </main>
    </div>
  );
}
