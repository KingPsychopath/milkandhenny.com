import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";

import { useActionDialog } from "@/hooks/useActionDialog";
import { EmailAddressNotice } from "@/components/EmailAddressNotice";
import { rememberBrowserProfile } from "@/lib/client/browser-profile";
import {
  cancelTicketOperationFn,
  resendTicketOperationFn,
} from "@/features/attendee-operations/ticket-operations.functions";
import {
  removeAttendeeEmailFn,
  requestAttendeeAccessFn,
  signOutAttendeeFn,
  updateAttendeeNameFn,
} from "../access.functions";
import type { AttendeeAccount } from "../types";
import { TeamBadge } from "@/features/event-scoring/ui/TeamBadge";
import { SecuritySettingsPanel } from "./SecuritySettingsPanel";
import { AchievementCabinet } from "@/features/achievements/ui/AchievementCollection";

function ticketGroups(tickets: AttendeeAccount["tickets"]) {
  const groups = new Map<
    string,
    {
      eventSlug: string;
      eventTitle: string;
      managesOrder: boolean;
      orderPoints?: number;
      tickets: AttendeeAccount["tickets"];
    }
  >();
  for (const ticket of tickets) {
    const key = `${ticket.eventSlug}:${ticket.orderId}`;
    const current = groups.get(key);
    if (current) {
      current.tickets.push(ticket);
      current.managesOrder ||= ticket.managesOrder;
      current.orderPoints ??= ticket.orderPoints;
    } else {
      groups.set(key, {
        eventSlug: ticket.eventSlug,
        eventTitle: ticket.eventTitle,
        managesOrder: ticket.managesOrder,
        orderPoints: ticket.orderPoints,
        tickets: [ticket],
      });
    }
  }
  return [...groups.values()];
}

function formatAccountDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/London",
  }).format(date);
}

function formatAccountDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}

function gamePath(
  game: string,
  mode: AttendeeAccount["gameHistory"][number]["mode"],
):
  | "/things"
  | "/things/hot-and-cold"
  | "/things/hot-and-cold/daily"
  | "/things/centre"
  | "/things/draw-country"
  | "/things/heads-up"
  | "/things/icebreaker"
  | "/things/liars"
  | "/things/same-brain"
  | "/things/spelling-bee"
  | "/things/spelling-party"
  | "/things/twin" {
  if (game === "hot-and-cold" && mode === "daily") return "/things/hot-and-cold/daily";
  const paths = {
    "hot-and-cold": "/things/hot-and-cold",
    centre: "/things/centre",
    "draw-country": "/things/draw-country",
    "heads-up": "/things/heads-up",
    icebreaker: "/things/icebreaker",
    liars: "/things/liars",
    "same-brain": "/things/same-brain",
    "spelling-bee": "/things/spelling-bee",
    "spelling-party": "/things/spelling-party",
    twin: "/things/twin",
  } as const;
  return game in paths ? paths[game as keyof typeof paths] : "/things";
}

function GameHistoryLink({
  game,
  children,
}: {
  game: AttendeeAccount["gameHistory"][number];
  children: ReactNode;
}) {
  const className = "flex min-h-14 items-center justify-between gap-4 py-3 hover:opacity-70";
  const puzzle = Number(game.reference);
  if (
    game.game === "hot-and-cold" &&
    game.mode === "daily" &&
    Number.isSafeInteger(puzzle) &&
    puzzle > 0
  )
    return (
      <Link
        to="/things/hot-and-cold/daily/$puzzle"
        params={{ puzzle: String(puzzle) }}
        className={className}
      >
        {children}
      </Link>
    );
  return (
    <Link to={gamePath(game.game, game.mode)} className={className}>
      {children}
    </Link>
  );
}

export function MyAccountPage({
  account: initialAccount,
  emailStepUpRequired: initialEmailStepUpRequired,
  security,
}: {
  account: AttendeeAccount;
  emailStepUpRequired: boolean;
  security: {
    passkeys: Array<{
      id: string;
      label: string;
      createdAt: string;
      lastUsedAt?: string;
      backedUp: boolean;
      deviceType: "singleDevice" | "multiDevice";
    }>;
    totp: {
      enabled: boolean;
      label?: string;
      createdAt?: string;
      lastUsedAt?: string;
      recoveryCodesRemaining: number;
    };
  };
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [account, setAccount] = useState(initialAccount);
  const [name, setName] = useState(initialAccount.name ?? "");
  const [newEmail, setNewEmail] = useState("");
  const [emailStepUpRequired, setEmailStepUpRequired] = useState(initialEmailStepUpRequired);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (initialAccount.name) rememberBrowserProfile({ name: initialAccount.name });
  }, [initialAccount.name]);

  useEffect(() => setAccount(initialAccount), [initialAccount]);

  useEffect(() => {
    const refreshScores = () => void router.invalidate();
    window.addEventListener("mah-score-wake", refreshScores);
    return () => window.removeEventListener("mah-score-wake", refreshScores);
  }, [router]);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await updateAttendeeNameFn({ data: { name } });
      setMessage(result.ok ? "Preferred name updated." : result.error);
      if (result.ok && result.value.name && account) {
        setAccount({ ...account, name: result.value.name });
        rememberBrowserProfile({ name: result.value.name });
      }
    } catch {
      setMessage("The preferred name could not be updated. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function addEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await requestAttendeeAccessFn({
        data: { email: newEmail, purpose: "add-email", returnTo: "/my" },
      });
      if (!result.ok && result.status === 403) setEmailStepUpRequired(true);
      setMessage(
        result.ok ? "Check the new address and verify it within 15 minutes." : result.error,
      );
    } catch {
      setMessage("The verification email could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setSigningOut(true);
    setMessage("");
    try {
      await signOutAttendeeFn();
      await navigate({ to: "/access", search: { returnTo: "/my" }, replace: true });
      router.clearCache();
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign out");
      setBusy(false);
      setSigningOut(false);
    }
  }

  async function removeEmail(email: AttendeeAccount["emails"][number]) {
    if (emailStepUpRequired) {
      setMessage("Sign in again with an existing email before removing one.");
      return;
    }
    if (
      !(await confirmAction({
        eyebrow: "sign-in security",
        title: `Remove ${email.masked}?`,
        description:
          "This address will stop working for sign-in. Your tickets, points, orders, and permissions stay with your account. You will be signed out on every device.",
        confirmLabel: "remove email",
        intent: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await removeAttendeeEmailFn({ data: { identifierId: email.id } });
      if (!result.ok) {
        if (result.status === 403) setEmailStepUpRequired(true);
        throw new Error(result.error);
      }
      await navigate({ to: "/access", search: { returnTo: "/my" }, replace: true });
      router.clearCache();
      await router.invalidate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sign-in email could not be removed");
      setBusy(false);
    }
  }

  async function cancelOperation(kind: "assignment" | "transfer" | "return", operationId: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await cancelTicketOperationFn({ data: { kind, operationId } });
      if (!result.ok) setMessage(result.error);
      else {
        setMessage(kind === "return" ? "Return request cancelled." : "Invitation cancelled.");
        setAccount((current) => {
          if (!current) return current;
          const key =
            kind === "assignment"
              ? "outgoingAssignments"
              : kind === "transfer"
                ? "outgoingTransfers"
                : "returnRequests";
          return {
            ...current,
            ticketOperations: {
              ...current.ticketOperations,
              [key]: current.ticketOperations[key].map((item) =>
                item.id === operationId ? { ...item, status: "cancelled" } : item,
              ),
            },
          };
        });
      }
    } catch {
      setMessage("That ticket action could not be cancelled. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendOperation(kind: "assignment" | "transfer", operationId: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await resendTicketOperationFn({ data: { kind, operationId } });
      if (!result.ok) setMessage(result.error);
      else {
        setMessage("Invitation resent.");
        setAccount((current) => {
          if (!current || !result.value.expiresAt) return current;
          const key = kind === "assignment" ? "outgoingAssignments" : "outgoingTransfers";
          return {
            ...current,
            ticketOperations: {
              ...current.ticketOperations,
              [key]: current.ticketOperations[key].map((item) =>
                item.id === operationId ? { ...item, expiresAt: result.value.expiresAt } : item,
              ),
            },
          };
        });
      }
    } catch {
      setMessage("The invitation could not be resent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <Link
        to="/"
        className="inline-flex min-h-11 items-center font-mono text-micro theme-muted hover:text-foreground"
      >
        ← milk &amp; henny
      </Link>
      <h1 className="mt-10 font-serif text-4xl">account</h1>
      <p className="mt-3 font-mono text-xs theme-muted">
        {account.name ? `Signed in as ${account.name}` : "Signed in"}
      </p>
      <button
        type="button"
        disabled={busy}
        aria-busy={signingOut}
        onClick={() => void signOut()}
        className="mh-action mh-action--secondary mt-5 disabled:opacity-45"
      >
        {signingOut ? "signing out…" : "sign out"}
      </button>
      <section className="mt-8" aria-labelledby="my-tickets-heading">
        <h2 id="my-tickets-heading" className="font-serif text-2xl">
          Your events
        </h2>
        {account.tickets.length === 0 ? (
          <p className="mt-3 font-mono text-xs theme-muted">
            No tickets are saved yet. Open a ticket link and choose “save this ticket to You”.
          </p>
        ) : (
          <ul className="mt-4 divide-y border-y theme-border">
            {ticketGroups(account.tickets).map((group) => (
              <li key={`${group.eventTitle}:${group.tickets[0]!.orderId}`} className="py-5">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-serif text-xl">{group.eventTitle}</h3>
                  <Link
                    to="/events/$slug/score"
                    params={{ slug: group.eventSlug }}
                    className="inline-flex min-h-11 shrink-0 items-center font-mono text-micro underline hover:opacity-70"
                  >
                    leaderboard
                  </Link>
                </div>
                <p className="mt-1 font-mono text-micro theme-muted">
                  {group.tickets.length} {group.tickets.length === 1 ? "ticket" : "tickets"}
                  {group.managesOrder ? " · you manage this order" : ""}
                  {group.orderPoints !== undefined
                    ? ` · ${group.orderPoints} points across the order`
                    : ""}
                </p>
                <ul className="mt-3 divide-y border-y theme-border">
                  {group.tickets.map((ticket) => (
                    <li key={ticket.id}>
                      <Link
                        to="/ticket/$id"
                        params={{ id: ticket.publicId }}
                        className="flex min-h-11 items-center justify-between gap-4 py-3 hover:opacity-70"
                      >
                        <span className="min-w-0 font-mono text-xs">
                          <span className="block truncate">
                            {ticket.holderName}
                            {ticket.personallyClaimed ? " · saved to You" : ""}
                          </span>
                          {ticket.teamName ? (
                            <TeamBadge
                              name={`Team ${ticket.teamName}`}
                              colourKey={ticket.teamColourKey}
                              className="mt-1 flex w-fit"
                            />
                          ) : null}
                        </span>
                        <span className="shrink-0 font-mono text-micro theme-muted">
                          {group.orderPoints !== undefined && group.tickets.length > 1
                            ? `${group.orderPoints} total (${ticket.points} this ticket)`
                            : `${ticket.points} pts`}
                          {ticket.rank ? ` · #${ticket.rank}` : ""} →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AchievementCabinet achievements={account.achievements} />

      <section className="mt-10 border-t theme-border pt-6" aria-labelledby="my-pitches-heading">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="my-pitches-heading" className="font-serif text-2xl">
              Pitches
            </h2>
            <p className="mt-2 max-w-md font-mono text-micro leading-relaxed theme-muted">
              Durable pitches belong to You. Each browser also keeps an offline safety copy.
            </p>
          </div>
          <Link to="/things/pitches/new" className="mh-action mh-action--quiet shrink-0">
            new pitch →
          </Link>
        </div>
        {account.pitches.length > 0 ? (
          <ul className="mt-4 divide-y border-y theme-border">
            {account.pitches.map((pitch) => (
              <li key={pitch.id}>
                <Link
                  to="/things/pitches/$deckId/edit"
                  params={{ deckId: pitch.id }}
                  className="flex min-h-14 items-center justify-between gap-4 py-3 hover:opacity-70"
                >
                  <span className="font-serif text-xl">{pitch.title}</span>
                  <span className="shrink-0 font-mono text-micro theme-muted">
                    {formatAccountDate(pitch.updatedAt)} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 font-mono text-xs theme-muted">
            No account-owned pitches yet. Device-only copies are shown on the pitch wall.
          </p>
        )}
      </section>

      {account.gameHistory.length > 0 ? (
        <section
          className="mt-10 border-t theme-border pt-6"
          aria-labelledby="game-history-heading"
        >
          <h2 id="game-history-heading" className="font-serif text-2xl">
            Game history
          </h2>
          <p className="mt-2 max-w-md font-mono text-micro leading-relaxed theme-muted">
            Signed-in play stays with this account. A game name can differ from your preferred name
            without changing either one.
          </p>
          <ul className="mt-5 grid gap-x-6 gap-y-5 border-y theme-border py-5 sm:grid-cols-2">
            {account.gameStats.map((stats) => (
              <li key={stats.game}>
                <p className="font-mono text-xs">{stats.game.replaceAll("-", " ")}</p>
                <p className="mt-2 font-serif text-xl">
                  {stats.plays} {stats.plays === 1 ? "play" : "plays"} · {stats.wins} won
                </p>
                <p className="mt-1 font-mono text-micro leading-relaxed theme-muted">
                  {stats.guesses !== undefined
                    ? [
                        `${stats.guesses} guesses`,
                        `${stats.hotGuesses} warm`,
                        `${stats.coldGuesses} cold`,
                        `${stats.hints} hints`,
                        stats.bestRank !== undefined ? `best #${stats.bestRank}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : `${stats.completed} completed · ${stats.actions} actions`}
                </p>
              </li>
            ))}
          </ul>
          <ul className="mt-4 divide-y border-y theme-border">
            {account.gameHistory.map((game) => (
              <li key={game.id}>
                <GameHistoryLink game={game}>
                  <div>
                    <p className="font-mono text-xs">{game.game.replaceAll("-", " ")}</p>
                    <p className="mt-1 font-mono text-micro theme-muted">
                      {game.mode === "daily" ? `daily #${game.reference}` : game.mode}
                      {game.displayName ? ` · as ${game.displayName}` : ""}
                      {` · ${game.eventCount} ${game.eventCount === 1 ? "action" : "actions"}`}
                    </p>
                  </div>
                  <p className="shrink-0 text-right font-mono text-micro theme-muted">
                    {game.outcome ?? game.status}
                    {game.score !== undefined ? ` · ${game.score}` : ""}
                    <br />
                    {formatAccountDate(game.lastPlayedAt)} →
                  </p>
                </GameHistoryLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {[
        ...account.ticketOperations.incomingAssignments,
        ...account.ticketOperations.incomingTransfers,
        ...account.ticketOperations.outgoingAssignments,
        ...account.ticketOperations.outgoingTransfers,
        ...account.ticketOperations.returnRequests,
      ].length > 0 ? (
        <section
          className="mt-10 border-t theme-border pt-6"
          aria-labelledby="ticket-actions-heading"
        >
          <h2 id="ticket-actions-heading" className="font-serif text-2xl">
            Ticket actions
          </h2>
          <ul className="mt-4 divide-y border-y theme-border">
            {account.ticketOperations.outgoingAssignments.map((item) => (
              <AttendeeOperationRow
                key={item.id}
                label="assignment sent"
                item={item}
                busy={busy}
                onCancel={() => void cancelOperation("assignment", item.id)}
                onResend={() => void resendOperation("assignment", item.id)}
              />
            ))}
            {account.ticketOperations.outgoingTransfers.map((item) => (
              <AttendeeOperationRow
                key={item.id}
                label="transfer sent"
                item={item}
                busy={busy}
                onCancel={() => void cancelOperation("transfer", item.id)}
                onResend={() => void resendOperation("transfer", item.id)}
              />
            ))}
            {account.ticketOperations.incomingAssignments.map((item) => (
              <AttendeeOperationRow
                key={item.id}
                label="incoming assignment"
                item={item}
                busy={busy}
              />
            ))}
            {account.ticketOperations.incomingTransfers.map((item) => (
              <AttendeeOperationRow
                key={item.id}
                label="incoming transfer"
                item={item}
                busy={busy}
              />
            ))}
            {account.ticketOperations.returnRequests.map((item) => (
              <AttendeeOperationRow
                key={item.id}
                label="ticket return"
                item={item}
                busy={busy}
                onCancel={
                  item.canCancel ? () => void cancelOperation("return", item.id) : undefined
                }
              />
            ))}
          </ul>
        </section>
      ) : null}

      {account.access.length > 0 ? (
        <section
          className="mt-10 border-t theme-border pt-6"
          aria-labelledby="staff-access-heading"
        >
          <h2 id="staff-access-heading" className="font-serif text-2xl">
            Staff access
          </h2>
          <ul className="mt-4 divide-y border-y theme-border font-mono text-xs">
            {account.access.map((grant, index) => (
              <li
                key={`${grant.kind}:${grant.eventSlug ?? "global"}:${grant.label}:${index}`}
                className="py-4"
              >
                {grant.href ? (
                  <a
                    href={grant.href}
                    className="inline-flex min-h-11 items-center py-3 underline hover:opacity-70"
                  >
                    {grant.label.replaceAll("-", " ")}
                  </a>
                ) : (
                  <span>{grant.label.replaceAll("-", " ")}</span>
                )}
                <span className="ml-2 theme-muted">
                  {grant.eventSlug ? `· ${grant.eventSlug} ` : "· global "}· {grant.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SecuritySettingsPanel initialPasskeys={security.passkeys} initialTotp={security.totp} />

      <details className="mt-10 border-t theme-border pt-2">
        <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
          name and email
        </summary>
        <form onSubmit={saveName} className="space-y-3 py-3">
          <label htmlFor="account-name" className="block font-mono text-xs">
            preferred name
          </label>
          <input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            autoComplete="name"
            className="min-h-11 w-full max-w-sm border theme-border bg-background px-3 font-mono text-base sm:text-sm"
          />
          <p className="max-w-md font-mono text-micro leading-relaxed theme-muted">
            Your private full name as you naturally write it. It suggests an editable name in games;
            it does not replace ticket-holder names, event aliases, or game nicknames.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
          >
            save name
          </button>
        </form>
        <form onSubmit={addEmail} className="space-y-3 border-t theme-border py-5">
          <div>
            <h3 className="font-mono text-xs">sign-in emails</h3>
            <ul className="mt-2 divide-y border-y theme-border">
              {account.emails.map((email) => (
                <li
                  key={email.id}
                  className="flex min-h-12 items-center justify-between gap-4 py-2"
                >
                  <span className="font-mono text-xs">{email.masked}</span>
                  {account.emails.length > 1 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeEmail(email)}
                      className="mh-action mh-action--danger disabled:opacity-45"
                    >
                      remove
                    </button>
                  ) : (
                    <span className="font-mono text-micro theme-muted">only sign-in email</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 max-w-md font-mono text-micro leading-relaxed theme-muted">
              Add another only if tickets reach more than one address. Existing emails stay
              connected.
            </p>
          </div>
          {emailStepUpRequired ? (
            <div className="border-y theme-border py-4">
              <p className="max-w-md font-mono text-xs leading-relaxed">
                Sign in again with an existing email before adding another.
              </p>
              <Link
                to="/access"
                search={{ returnTo: "/my" }}
                className="mh-action mh-action--quiet mt-3"
              >
                verify existing email →
              </Link>
            </div>
          ) : (
            <>
              <label htmlFor="new-email" className="block font-mono text-xs">
                another sign-in email
              </label>
              <input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                required
                autoComplete="email"
                className="min-h-11 w-full max-w-sm border theme-border bg-background px-3 font-mono text-base sm:text-sm"
              />
              <EmailAddressNotice email={newEmail} onAcceptSuggestion={setNewEmail} />
              <button
                type="submit"
                disabled={busy}
                className="mh-action mh-action--secondary disabled:opacity-45"
              >
                verify new email
              </button>
            </>
          )}
        </form>
      </details>
      {message ? (
        <p role="status" className="mt-5 font-mono text-xs theme-muted">
          {message}
        </p>
      ) : null}
      {actionDialog}
    </main>
  );
}

export function AttendeeOperationRow({
  label,
  item,
  busy,
  onCancel,
  onResend,
}: {
  label: string;
  item: AttendeeAccount["ticketOperations"]["outgoingAssignments"][number];
  busy: boolean;
  onCancel?: () => void;
  onResend?: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div>
        <p className="font-mono text-xs">
          {label} · {item.eventTitle}
        </p>
        <p className="mt-1 font-mono text-micro theme-muted">
          {item.status} · expires {formatAccountDateTime(item.expiresAt)}
        </p>
      </div>
      {onCancel && item.status === "pending" ? (
        <div className="flex gap-2">
          {onResend ? (
            <button
              type="button"
              disabled={busy}
              onClick={onResend}
              className="min-h-11 px-2 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
            >
              resend
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 px-2 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
          >
            cancel
          </button>
        </div>
      ) : null}
    </li>
  );
}
