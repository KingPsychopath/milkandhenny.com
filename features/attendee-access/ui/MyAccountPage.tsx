import { FormEvent, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useActionDialog } from "@/hooks/useActionDialog";
import { attendeeSignInHref, type AttendeeAccount } from "../types";

type AccountResponse = {
  authenticated: boolean;
  account: AttendeeAccount | null;
  emailStepUpRequired: boolean;
};

function ticketGroups(tickets: AttendeeAccount["tickets"]) {
  const groups = new Map<
    string,
    {
      eventTitle: string;
      managesOrder: boolean;
      tickets: AttendeeAccount["tickets"];
    }
  >();
  for (const ticket of tickets) {
    const key = `${ticket.eventSlug}:${ticket.orderId}`;
    const current = groups.get(key);
    if (current) {
      current.tickets.push(ticket);
      current.managesOrder ||= ticket.managesOrder;
    } else {
      groups.set(key, {
        eventTitle: ticket.eventTitle,
        managesOrder: ticket.managesOrder,
        tickets: [ticket],
      });
    }
  }
  return [...groups.values()];
}

export function MyAccountPage() {
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AttendeeAccount | null>(null);
  const [name, setName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailStepUpRequired, setEmailStepUpRequired] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    void fetch("/api/attendee/session", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Your details could not be loaded");
        return (await response.json()) as AccountResponse;
      })
      .then((body) => {
        if (!body.authenticated || !body.account) {
          window.location.replace(attendeeSignInHref("/my"));
          return;
        }
        setAccount(body.account);
        setName(body.account.name ?? "");
        setEmailStepUpRequired(body.emailStepUpRequired);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load"))
      .finally(() => setLoading(false));
  }, []);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/attendee/session", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; name?: string };
    setMessage(response.ok ? "Name updated." : (body.error ?? "Name could not be updated"));
    if (response.ok && body.name && account) setAccount({ ...account, name: body.name });
    setBusy(false);
  }

  async function addEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/attendee/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: newEmail, purpose: "add-email", returnTo: "/my" }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 403) setEmailStepUpRequired(true);
    setMessage(
      response.ok
        ? "Check the new address and verify it within 15 minutes."
        : (body.error ?? "That email could not be added"),
    );
    setBusy(false);
  }

  async function signOut() {
    setBusy(true);
    setSigningOut(true);
    setMessage("");
    try {
      const response = await fetch("/api/attendee/session", { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not sign out");
      }
      window.location.assign(attendeeSignInHref("/my"));
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
      const response = await fetch("/api/attendee/access", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifierId: email.id }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        if (response.status === 403) setEmailStepUpRequired(true);
        throw new Error(body.error ?? "The sign-in email could not be removed");
      }
      window.location.assign(attendeeSignInHref("/my"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sign-in email could not be removed");
      setBusy(false);
    }
  }

  async function cancelOperation(kind: "assignment" | "transfer" | "return", operationId: string) {
    setBusy(true);
    const response = await fetch("/api/attendee/ticket-operations", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, operationId }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setMessage(body.error ?? "The invitation could not be cancelled");
    else {
      setMessage("Invitation cancelled.");
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
    setBusy(false);
  }

  async function resendOperation(kind: "assignment" | "transfer", operationId: string) {
    setBusy(true);
    const response = await fetch("/api/attendee/ticket-operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resend", kind, operationId }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      expiresAt?: string;
    };
    if (!response.ok) setMessage(body.error ?? "The invitation could not be resent");
    else {
      setMessage("Invitation resent.");
      setAccount((current) => {
        if (!current || !body.expiresAt) return current;
        const key = kind === "assignment" ? "outgoingAssignments" : "outgoingTransfers";
        return {
          ...current,
          ticketOperations: {
            ...current.ticketOperations,
            [key]: current.ticketOperations[key].map((item) =>
              item.id === operationId ? { ...item, expiresAt: body.expiresAt! } : item,
            ),
          },
        };
      });
    }
    setBusy(false);
  }

  return (
    <main id="main" className="mx-auto min-h-screen w-full max-w-2xl px-6 py-14">
      <Link to="/" className="font-mono text-micro theme-muted hover:text-foreground">
        ← milk &amp; henny
      </Link>
      <h1 className="mt-10 font-serif text-4xl">account</h1>
      {loading || !account ? (
        <p className="mt-6 font-mono text-xs theme-muted">{message || "loading…"}</p>
      ) : (
        <>
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
                    <h3 className="font-serif text-xl">{group.eventTitle}</h3>
                    <p className="mt-1 font-mono text-micro theme-muted">
                      {group.tickets.length} {group.tickets.length === 1 ? "ticket" : "tickets"}
                      {group.managesOrder ? " · you manage this order" : ""}
                    </p>
                    <ul className="mt-3 divide-y border-y theme-border">
                      {group.tickets.map((ticket) => (
                        <li key={ticket.id}>
                          <Link
                            to="/ticket/$id"
                            params={{ id: ticket.publicId }}
                            className="flex min-h-11 items-center justify-between gap-4 py-3 hover:opacity-70"
                          >
                            <span className="min-w-0 truncate font-mono text-xs">
                              {ticket.holderName}
                              {ticket.personallyClaimed ? " · saved to You" : ""}
                            </span>
                            <span className="shrink-0 font-mono text-micro theme-muted">
                              {ticket.points} pts{ticket.rank ? ` · #${ticket.rank}` : ""} →
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
                      <a href={grant.href} className="min-h-11 py-3 underline hover:opacity-70">
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

          <details className="mt-10 border-t theme-border pt-2">
            <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
              name and email
            </summary>
            <form onSubmit={saveName} className="space-y-3 py-3">
              <label htmlFor="account-name" className="block font-mono text-xs">
                your name
              </label>
              <input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                autoComplete="name"
                className="min-h-11 w-full max-w-sm border theme-border bg-background px-3 font-mono text-sm"
              />
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
                    className="min-h-11 w-full max-w-sm border theme-border bg-background px-3 font-mono text-sm"
                  />
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
        </>
      )}
      {message && account ? (
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
          {item.status} · expires {new Date(item.expiresAt).toLocaleString()}
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
