import { FormEvent, useCallback, useEffect, useState } from "react";
import { AttendeePreviewMatrix } from "./AttendeePreviewMatrix";

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;
type InboxItem = {
  id: string;
  caseId?: string;
  title: string;
  body: string;
  eventSlug?: string;
  deepLink: string;
  status: "new" | "seen" | "in-progress" | "resolved" | "dismissed";
  createdAt: string;
};
type Person = {
  personId: string;
  canonicalName?: string;
  verifiedEmails: string[];
  tickets: Array<{
    id: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    status: string;
    orderId: string;
    participantId?: string;
    checkedInAt?: string;
    amountPaidMinor?: number;
    currency?: string;
    supportNote?: string;
    otherOrderTickets: number;
    scoreBalance: number;
    transferHistory: Array<{ status: string; recipientEmailHint: string; createdAt: string }>;
    returnHistory: Array<{
      status: string;
      amountMinor?: number;
      currency?: string;
      createdAt: string;
    }>;
    exchanges: Array<{ status: string; amountDeltaMinor: number; createdAt: string }>;
    communication: { total: number; failed: number };
  }>;
  globalRoles: Array<{ role: string; status: string }>;
  eventRoles: Array<{ eventSlug: string; label: string; status: string }>;
  pendingInvitations: number;
  staffDevices: number;
  auditTimeline: Array<{ action: string; actorType: string; reason?: string; createdAt: string }>;
};

export function AttendeeOperationsPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [tab, setTab] = useState<"inbox" | "people" | "preview">("inbox");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person>();
  const [loading, setLoading] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/operations/inbox");
      const body = (await response.json()) as {
        unresolved?: number;
        items?: InboxItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Inbox could not be loaded");
      setItems(body.items ?? []);
      setUnresolved(body.unresolved ?? 0);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Inbox could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    if (tab === "inbox") void loadInbox();
  }, [loadInbox, tab]);

  async function updateItem(item: InboxItem, status: InboxItem["status"]) {
    const reason =
      status === "resolved" || status === "dismissed"
        ? window.prompt("What resolved this item?")?.trim()
        : undefined;
    if ((status === "resolved" || status === "dismissed") && !reason) return;
    const response = await authFetch("/api/admin/operations/inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, status, reason }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      onError(body.error ?? "Inbox item could not be updated");
      return;
    }
    onStatus(status === "resolved" ? "Case resolved." : "Inbox updated.");
    await loadInbox();
  }

  async function findPeople(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await authFetch(
        `/api/admin/operations/people?q=${encodeURIComponent(query)}`,
      );
      const body = (await response.json()) as { people?: Person[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "People could not be searched");
      setPeople(body.people ?? []);
      setSelected(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : "People could not be searched");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="attendee-operations-heading">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b theme-border pb-5">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            attendee operations
          </p>
          <h2 id="attendee-operations-heading" className="mt-2 font-serif text-3xl">
            People who need an answer
          </h2>
        </div>
        <p className="font-mono text-xs theme-muted">{unresolved} unresolved</p>
      </div>
      <div className="mt-4 flex gap-5 border-b theme-border">
        {(["inbox", "people", "preview"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            aria-current={tab === name ? "page" : undefined}
            className={`min-h-11 border-b-2 px-1 font-mono text-xs ${
              tab === name ? "border-foreground" : "border-transparent theme-muted"
            }`}
          >
            {name === "inbox"
              ? `needs attention${unresolved ? ` · ${unresolved}` : ""}`
              : name === "people"
                ? "people and access"
                : "attendee preview"}
          </button>
        ))}
      </div>

      {tab === "inbox" ? (
        <div className="mt-5">
          {loading && !items.length ? (
            <p className="font-mono text-xs theme-muted">loading…</p>
          ) : null}
          {!loading && !items.length ? (
            <p className="border-y theme-border py-5 font-mono text-xs theme-muted">
              Nothing needs attention.
            </p>
          ) : (
            <ol className="divide-y border-y theme-border">
              {items.map((item) => (
                <li key={item.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-2xl">
                      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                        {item.status}
                        {item.eventSlug ? ` · ${item.eventSlug}` : ""}
                      </p>
                      <h3 className="mt-1 font-serif text-xl">{item.title}</h3>
                      <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
                        {item.body}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={item.deepLink}
                        className="min-h-11 py-3 font-mono text-xs underline hover:opacity-70"
                      >
                        open
                      </a>
                      {item.status === "new" ? (
                        <button
                          type="button"
                          onClick={() => void updateItem(item, "seen")}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          mark seen
                        </button>
                      ) : null}
                      {!(["resolved", "dismissed"] as string[]).includes(item.status) ? (
                        <button
                          type="button"
                          onClick={() => void updateItem(item, "resolved")}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          resolve
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : tab === "people" ? (
        <div className="mt-5">
          <form onSubmit={findPeople} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="people-search" className="sr-only">
              Search people
            </label>
            <input
              id="people-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="name, masked email, ticket, event, or person ID"
              className="min-h-11 min-w-0 flex-1 border theme-border bg-background px-3 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="min-h-11 border theme-border px-4 font-mono text-xs disabled:opacity-50"
            >
              search
            </button>
          </form>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
            <ul className="divide-y border-y theme-border">
              {people.map((person) => (
                <li key={person.personId}>
                  <button
                    type="button"
                    onClick={() => setSelected(person)}
                    className="min-h-14 w-full py-3 text-left hover:opacity-70"
                  >
                    <span className="block font-serif text-lg">
                      {person.canonicalName ?? "Unnamed person"}
                    </span>
                    <span className="font-mono text-micro theme-muted">
                      {person.verifiedEmails.join(", ") || person.personId} ·{" "}
                      {person.tickets.length} tickets
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <PersonDrawer person={selected} />
            ) : (
              <p className="font-mono text-xs theme-muted">
                Choose a person for the read-only attendee view.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <AttendeePreviewMatrix />
        </div>
      )}
    </section>
  );
}

function PersonDrawer({ person }: { person: Person }) {
  return (
    <aside className="border-y theme-border py-5" aria-label="Attendee detail">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
        read-only attendee view
      </p>
      <h3 className="mt-2 font-serif text-2xl">{person.canonicalName ?? "Unnamed person"}</h3>
      <p className="mt-1 font-mono text-micro theme-muted">{person.personId}</p>
      <dl className="mt-5 space-y-4 font-mono text-xs">
        <div>
          <dt className="theme-muted">verified email</dt>
          <dd className="mt-1">{person.verifiedEmails.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt className="theme-muted">access</dt>
          <dd className="mt-1">
            {[
              ...person.globalRoles.map((role) => role.role),
              ...person.eventRoles.map((role) => `${role.label} · ${role.eventSlug}`),
            ].join(", ") || "attendee only"}
          </dd>
        </div>
        <div>
          <dt className="theme-muted">devices / invitations</dt>
          <dd className="mt-1">
            {person.staffDevices} staff devices · {person.pendingInvitations} pending
          </dd>
        </div>
      </dl>
      <h4 className="mt-6 font-mono text-xs font-bold">tickets</h4>
      <ul className="mt-2 divide-y border-y theme-border">
        {person.tickets.map((ticket) => (
          <li key={ticket.id} className="py-3">
            <a
              href={`/ticket/${ticket.id}?preview=1`}
              className="font-mono text-xs underline hover:opacity-70"
            >
              {ticket.eventTitle} · {ticket.holderName}
            </a>
            <p className="mt-1 font-mono text-micro theme-muted">
              {ticket.status} · order {ticket.orderId}
            </p>
            <dl className="mt-3 grid gap-2 font-mono text-micro sm:grid-cols-2">
              <div>
                <dt className="theme-muted">admission</dt>
                <dd>
                  {ticket.checkedInAt
                    ? `checked in ${new Date(ticket.checkedInAt).toLocaleString()}`
                    : "not checked in"}
                </dd>
              </div>
              <div>
                <dt className="theme-muted">payment / refund</dt>
                <dd>
                  {ticket.amountPaidMinor === undefined
                    ? "complimentary"
                    : `${ticket.currency ?? "GBP"} ${(ticket.amountPaidMinor / 100).toFixed(2)}`}
                  {ticket.returnHistory[0] ? ` · ${ticket.returnHistory[0].status}` : ""}
                </dd>
              </div>
              <div>
                <dt className="theme-muted">order context</dt>
                <dd>
                  {ticket.otherOrderTickets} other ticket{ticket.otherOrderTickets === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt className="theme-muted">score / activity</dt>
                <dd>{ticket.scoreBalance} points</dd>
              </div>
              <div>
                <dt className="theme-muted">transfer history</dt>
                <dd>
                  {ticket.transferHistory
                    .map((item) => `${item.status} · ${item.recipientEmailHint}`)
                    .join(", ") || "none"}
                </dd>
              </div>
              <div>
                <dt className="theme-muted">exchange state</dt>
                <dd>{ticket.exchanges.map((item) => item.status).join(", ") || "none"}</dd>
              </div>
              <div>
                <dt className="theme-muted">communication delivery</dt>
                <dd>
                  {ticket.communication.total} sent · {ticket.communication.failed} failed
                </dd>
              </div>
              <div>
                <dt className="theme-muted">support note</dt>
                <dd>{ticket.supportNote ?? "none"}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <h4 className="mt-6 font-mono text-xs font-bold">audit timeline</h4>
      <ol className="mt-2 divide-y border-y theme-border">
        {person.auditTimeline.length ? (
          person.auditTimeline.map((event, index) => (
            <li
              key={`${event.createdAt}:${event.action}:${index}`}
              className="py-3 font-mono text-micro"
            >
              <p>
                {event.action} · {event.actorType}
              </p>
              <p className="mt-1 theme-muted">
                {new Date(event.createdAt).toLocaleString()}
                {event.reason ? ` · ${event.reason}` : ""}
              </p>
            </li>
          ))
        ) : (
          <li className="py-3 font-mono text-micro theme-muted">
            No attendee operations recorded.
          </li>
        )}
      </ol>
    </aside>
  );
}
