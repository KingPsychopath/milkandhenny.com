import { FormEvent, useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { OperationsTab } from "./AdminSectionNav";
import { AttendeePreviewMatrix } from "./AttendeePreviewMatrix";

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;
type StepUp = () => Promise<{ ok: true; token: string } | { ok: false }>;
type StepUpHeaders = (token: string, headers?: Record<string, string>) => Record<string, string>;
type InboxItem = {
  id: string;
  caseId?: string;
  title: string;
  body: string;
  eventSlug?: string;
  category: string;
  severity: "info" | "prompt" | "warning" | "critical";
  assigneePersonId?: string;
  assigneeName?: string;
  privateNote?: { body?: string; actorId?: string; updatedAt?: string };
  resolutionReason?: string;
  deepLink: string;
  status: "new" | "seen" | "in-progress" | "resolved" | "dismissed";
  createdAt: string;
};
type Administrator = { personId: string; name: string };
type InboxView = {
  name: string;
  status: string;
  severity: string;
  category: string;
  event: string;
};
type Person = {
  personId: string;
  canonicalName?: string;
  verifiedEmails: string[];
  identities: Array<{
    id: string;
    kind: "email";
    masked: string;
    status: "verified" | "pending" | "removed";
    verifiedAt?: string;
    removedAt?: string;
  }>;
  access: {
    acquisitionStatus: "active" | "restricted";
    restrictedAt?: string;
    restrictedBy?: string;
    restrictionReason?: string;
    activeSessions: number;
    lastSeenAt?: string;
    authenticatedAt?: string;
  };
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
  ensureStepUpToken,
  withStepUpHeaders,
  tab,
  onTabChange,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: StepUp;
  withStepUpHeaders: StepUpHeaders;
  tab: OperationsTab;
  onTabChange: (tab: OperationsTab) => void;
}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person>();
  const [loading, setLoading] = useState(false);
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [savedViews, setSavedViews] = useState<InboxView[]>([]);
  const [identityBusy, setIdentityBusy] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (severityFilter) params.set("severity", severityFilter);
      if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
      if (eventFilter.trim()) params.set("event", eventFilter.trim());
      const response = await authFetch(
        `/api/admin/operations/inbox${params.size ? `?${params}` : ""}`,
      );
      const body = (await response.json()) as {
        unresolved?: number;
        items?: InboxItem[];
        administrators?: Administrator[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Inbox could not be loaded");
      setItems(body.items ?? []);
      setUnresolved(body.unresolved ?? 0);
      setAdministrators(body.administrators ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Inbox could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [authFetch, categoryFilter, eventFilter, onError, severityFilter, statusFilter]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("attendee-operations-inbox-views");
      if (stored) setSavedViews(JSON.parse(stored) as InboxView[]);
    } catch {
      setSavedViews([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "inbox") void loadInbox();
  }, [loadInbox, tab]);

  async function updateItem(
    item: InboxItem,
    status: InboxItem["status"],
    extra: { assigneePersonId?: string; privateNote?: string } = {},
  ) {
    const reason =
      status === "resolved" || status === "dismissed"
        ? window.prompt("What resolved this item?")?.trim()
        : undefined;
    if ((status === "resolved" || status === "dismissed") && !reason) return;
    const response = await authFetch("/api/admin/operations/inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, status, reason, ...extra }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      onError(body.error ?? "Inbox item could not be updated");
      return;
    }
    onStatus(status === "resolved" ? "Case resolved." : "Inbox updated.");
    await loadInbox();
  }

  function saveView() {
    const name = window.prompt("Name this inbox view")?.trim();
    if (!name) return;
    const next = [
      ...savedViews.filter((view) => view.name !== name),
      {
        name,
        status: statusFilter,
        severity: severityFilter,
        category: categoryFilter,
        event: eventFilter,
      },
    ];
    setSavedViews(next);
    window.localStorage.setItem("attendee-operations-inbox-views", JSON.stringify(next));
    onStatus("Inbox view saved on this device.");
  }

  async function loadPeople(selectedPersonId?: string) {
    setLoading(true);
    try {
      const response = await authFetch(
        `/api/admin/operations/people?q=${encodeURIComponent(query)}`,
      );
      const body = (await response.json()) as { people?: Person[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "People could not be searched");
      const nextPeople = body.people ?? [];
      setPeople(nextPeople);
      setSelected(
        selectedPersonId
          ? nextPeople.find((person) => person.personId === selectedPersonId)
          : undefined,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "People could not be searched");
    } finally {
      setLoading(false);
    }
  }

  async function findPeople(event: FormEvent) {
    event.preventDefault();
    await loadPeople();
  }

  async function manageIdentity(
    person: Person,
    action: "sign-out" | "restrict" | "restore" | "remove-email",
    identifierId?: string,
  ) {
    const label =
      action === "sign-out"
        ? "sign this person out on every device"
        : action === "remove-email"
          ? "remove this email as a sign-in identity and sign this person out everywhere"
          : action === "restrict"
            ? "prevent this person from buying new tickets or receiving new staff/admin permissions"
            : "allow this person to acquire new tickets and permissions again";
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;
    const reason = window.prompt("Reason for the audit log")?.trim();
    if (!reason) return;
    setIdentityBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/people", {
        method: "PATCH",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({ personId: person.personId, action, reason, identifierId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        revokedSessions?: number;
        revokedPendingPermissions?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "Identity access could not be updated");
      const revoked = body.revokedSessions ?? 0;
      onStatus(
        action === "restore"
          ? "New ticket and permission acquisition restored."
          : action === "remove-email"
            ? `Email removed and ${revoked} active session${revoked === 1 ? "" : "s"} revoked.`
            : action === "restrict"
              ? `New acquisition restricted; ${body.revokedPendingPermissions ?? 0} pending permission invitation${body.revokedPendingPermissions === 1 ? "" : "s"} revoked.`
              : `${revoked} session${revoked === 1 ? "" : "s"} revoked.`,
      );
      await loadPeople(person.personId);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Identity access could not be updated");
    } finally {
      setIdentityBusy(false);
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
            {tab === "people"
              ? "Identity manager"
              : tab === "preview"
                ? "Attendee experience"
                : "People who need an answer"}
          </h2>
        </div>
        {tab === "inbox" ? (
          <p className="font-mono text-xs theme-muted">{unresolved} unresolved</p>
        ) : null}
      </div>
      <div className="mt-4 flex gap-5 border-b theme-border">
        {(["inbox", "people", "preview"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onTabChange(name)}
            aria-current={tab === name ? "page" : undefined}
            className={`min-h-11 border-b-2 px-1 font-mono text-xs ${
              tab === name ? "border-foreground" : "border-transparent theme-muted"
            }`}
          >
            {name === "inbox"
              ? `needs attention${unresolved ? ` · ${unresolved}` : ""}`
              : name === "people"
                ? "identity manager"
                : "attendee preview"}
          </button>
        ))}
      </div>

      {tab === "inbox" ? (
        <div className="mt-5">
          <div className="mb-5 grid gap-3 border-y theme-border py-4 sm:grid-cols-2 lg:grid-cols-5">
            <AppSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "", label: "all statuses" },
                ...(["new", "seen", "in-progress", "resolved", "dismissed"] as const).map(
                  (status) => ({ value: status, label: status }),
                ),
              ]}
              variant="field"
              ariaLabel="Filter by status"
            />
            <AppSelect
              value={severityFilter}
              onValueChange={setSeverityFilter}
              options={[
                { value: "", label: "all severities" },
                ...(["critical", "warning", "prompt", "info"] as const).map((severity) => ({
                  value: severity,
                  label: severity,
                })),
              ]}
              variant="field"
              ariaLabel="Filter by severity"
            />
            <input
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              placeholder="category"
              aria-label="filter by category"
              className="min-h-11 border theme-border bg-background px-2 font-mono text-xs"
            />
            <input
              value={eventFilter}
              onChange={(event) => setEventFilter(event.target.value)}
              placeholder="event slug"
              aria-label="filter by event"
              className="min-h-11 border theme-border bg-background px-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={saveView}
              className="min-h-11 border theme-border px-3 font-mono text-xs"
            >
              save view
            </button>
          </div>
          {savedViews.length ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {savedViews.map((view) => (
                <button
                  key={view.name}
                  type="button"
                  onClick={() => {
                    setStatusFilter(view.status);
                    setSeverityFilter(view.severity);
                    setCategoryFilter(view.category);
                    setEventFilter(view.event);
                  }}
                  className="min-h-11 px-2 font-mono text-micro underline"
                >
                  {view.name}
                </button>
              ))}
            </div>
          ) : null}
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
                        {` · ${item.severity} · ${item.category}`}
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
                      {item.status === "seen" ? (
                        <button
                          type="button"
                          onClick={() => void updateItem(item, "in-progress")}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          start work
                        </button>
                      ) : null}
                      {item.caseId ? (
                        <AppSelect
                          value={item.assigneePersonId ?? ""}
                          onValueChange={(value) =>
                            void updateItem(item, item.status, {
                              assigneePersonId: value || undefined,
                            })
                          }
                          options={[
                            { value: "", label: "unassigned" },
                            ...administrators.map((administrator) => ({
                              value: administrator.personId,
                              label: administrator.name,
                            })),
                          ]}
                          ariaLabel={`Assign ${item.title}`}
                        />
                      ) : null}
                      {item.caseId ? (
                        <button
                          type="button"
                          onClick={() => {
                            const privateNote = window
                              .prompt("Private note", item.privateNote?.body ?? "")
                              ?.trim();
                            if (privateNote) void updateItem(item, item.status, { privateNote });
                          }}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          private note
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
                  {item.assigneeName || item.privateNote?.body || item.resolutionReason ? (
                    <div className="mt-3 border-t theme-border pt-3 font-mono text-micro theme-muted">
                      {item.assigneeName ? <p>assigned to {item.assigneeName}</p> : null}
                      {item.privateNote?.body ? (
                        <p>private note · {item.privateNote.body}</p>
                      ) : null}
                      {item.resolutionReason ? <p>resolution · {item.resolutionReason}</p> : null}
                    </div>
                  ) : null}
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
              className="mh-action mh-action--secondary disabled:opacity-50"
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
              <PersonDrawer person={selected} busy={identityBusy} onManage={manageIdentity} />
            ) : (
              <p className="font-mono text-xs theme-muted">
                Choose a person to inspect identities, sessions, tickets, and access.
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

function PersonDrawer({
  person,
  busy,
  onManage,
}: {
  person: Person;
  busy: boolean;
  onManage: (
    person: Person,
    action: "sign-out" | "restrict" | "restore" | "remove-email",
    identifierId?: string,
  ) => Promise<void>;
}) {
  const recentlyActive =
    person.access.lastSeenAt !== undefined &&
    Date.now() - Date.parse(person.access.lastSeenAt) < 5 * 60 * 1_000;
  const verifiedIdentityCount = person.identities.filter(
    (identity) => identity.status === "verified",
  ).length;
  return (
    <aside className="border-y theme-border py-5" aria-label="Attendee detail">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">identity manager</p>
      <h3 className="mt-2 font-serif text-2xl">{person.canonicalName ?? "Unnamed person"}</h3>
      <p className="mt-1 font-mono text-micro theme-muted">{person.personId}</p>
      <dl className="mt-5 space-y-4 font-mono text-xs">
        <div>
          <dt className="theme-muted">email identities</dt>
          <dd className="mt-1">
            {person.identities.length ? (
              <ul className="divide-y border-y theme-border">
                {person.identities.map((identity) => (
                  <li key={identity.id} className="py-2">
                    <span>{identity.masked}</span>
                    <span className="ml-2 theme-muted">· {identity.status}</span>
                    {identity.removedAt ? (
                      <span className="mt-1 block theme-muted">
                        removed {new Date(identity.removedAt).toLocaleString()}
                      </span>
                    ) : null}
                    {identity.status === "verified" && verifiedIdentityCount > 1 ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onManage(person, "remove-email", identity.id)}
                        className="mh-action mh-action--danger mt-2 disabled:opacity-40"
                      >
                        remove sign-in
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              "none"
            )}
          </dd>
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
          <dt className="theme-muted">sessions</dt>
          <dd className="mt-1">
            {person.access.activeSessions} active session
            {person.access.activeSessions === 1 ? "" : "s"}
            {recentlyActive ? " · active in the last 5 minutes" : ""}
          </dd>
          {person.access.lastSeenAt ? (
            <dd className="mt-1 theme-muted">
              last seen {new Date(person.access.lastSeenAt).toLocaleString()}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="theme-muted">new tickets and permissions</dt>
          <dd className="mt-1">{person.access.acquisitionStatus}</dd>
          {person.access.restrictionReason ? (
            <dd className="mt-1 theme-muted">
              restricted{" "}
              {person.access.restrictedAt
                ? new Date(person.access.restrictedAt).toLocaleString()
                : ""}
              {` · ${person.access.restrictionReason}`}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="theme-muted">devices / invitations</dt>
          <dd className="mt-1">
            {person.staffDevices} staff devices · {person.pendingInvitations} pending
          </dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-3 border-y theme-border py-4">
        <button
          type="button"
          disabled={busy || person.access.activeSessions === 0}
          onClick={() => void onManage(person, "sign-out")}
          className="mh-action mh-action--secondary disabled:opacity-40"
        >
          sign out everywhere
        </button>
        {person.access.acquisitionStatus === "active" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onManage(person, "restrict")}
            className="mh-action mh-action--danger disabled:opacity-40"
          >
            restrict new access
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onManage(person, "restore")}
            className="mh-action mh-action--secondary disabled:opacity-40"
          >
            restore new access
          </button>
        )}
      </div>
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
