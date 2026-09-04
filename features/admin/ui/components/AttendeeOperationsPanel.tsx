import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AppSelect } from "@/components/AppSelect";
import { useActionDialog } from "@/hooks/useActionDialog";
import type { OperationsTab } from "./AdminSectionNav";
import { AttendeePreviewMatrix } from "./AttendeePreviewMatrix";
import { parseSavedInboxViews, type StoredInboxView } from "../admin-inbox-views";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";
import { AdminLoadError, AdminLoading } from "./AdminLoadState";

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
  status: "new" | "in-progress" | "resolved" | "dismissed";
  unread: boolean;
  readAt?: string;
  createdAt: string;
};
type Administrator = { personId: string; name: string };
type CaseEditor = { itemId: string; mode: "private-note" | "resolve"; value: string };
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
  accountPermissions: Array<"create_transfers">;
  eventRoles: Array<{ eventSlug: string; label: string; status: string }>;
  pendingInvitations: number;
  staffDevices: number;
  auditTimeline: Array<{ action: string; actorType: string; reason?: string; createdAt: string }>;
};
type PurchaserContact = {
  contactId: string;
  name?: string;
  emailHint: string;
  lastPurchasedAt: string;
  tickets: Array<{
    id: string;
    eventSlug: string;
    eventTitle: string;
    holderName: string;
    status: string;
    orderId: string;
    issuedAt: string;
    deliveryStatus?: string;
    deliveryNeedsAttention: boolean;
  }>;
};

export function AttendeeOperationsPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
  tab,
  onTabChange,
  initialEvent,
  initialTicket,
  initialPerson,
  onPersonChange,
  inboxOnly = false,
  availableTabs,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: StepUp;
  withStepUpHeaders: StepUpHeaders;
  tab: OperationsTab;
  onTabChange: (tab: OperationsTab) => void;
  initialEvent?: string;
  initialTicket?: string;
  initialPerson?: string;
  onPersonChange: (personId?: string) => void;
  inboxOnly?: boolean;
  availableTabs: readonly OperationsTab[];
}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const [unread, setUnread] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [purchaserContacts, setPurchaserContacts] = useState<PurchaserContact[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person>();
  const [selectedContact, setSelectedContact] = useState<PurchaserContact>();
  const [loading, setLoading] = useState(false);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxLoadError, setInboxLoadError] = useState<string | null>(null);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [peopleLoadError, setPeopleLoadError] = useState<string | null>(null);
  const [administrators, setAdministrators] = useState<Administrator[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [savedViews, setSavedViews] = useState<StoredInboxView[]>([]);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [inboxBusy, setInboxBusy] = useState<string>();
  const [caseEditor, setCaseEditor] = useState<CaseEditor>();
  const { prompt, dialog } = useActionDialog();

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setInboxLoadError(null);
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
        unread?: number;
        items?: InboxItem[];
        administrators?: Administrator[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Inbox could not be loaded");
      setItems(body.items ?? []);
      setUnresolved(body.unresolved ?? 0);
      setUnread(body.unread ?? 0);
      setAdministrators(body.administrators ?? []);
      setInboxLoaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Inbox could not be loaded";
      setInboxLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, categoryFilter, eventFilter, onError, severityFilter, statusFilter]);

  useEffect(() => {
    try {
      setSavedViews(
        parseSavedInboxViews(window.localStorage.getItem("attendee-operations-inbox-views")),
      );
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
    extra: { assigneePersonId?: string | null; privateNote?: string; reason?: string } = {},
  ): Promise<boolean> {
    setInboxBusy(item.id);
    try {
      const response = await authFetch("/api/admin/operations/inbox", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, status, ...extra }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Inbox item could not be updated");
      }
      if (status === "in-progress" && item.unread) {
        await setItemRead(item, true, false);
      }
      onStatus(
        status === "resolved"
          ? "Case resolved."
          : extra.privateNote
            ? "Private note saved."
            : "Inbox updated.",
      );
      await loadInbox();
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Inbox item could not be updated");
      return false;
    } finally {
      setInboxBusy(undefined);
    }
  }

  async function submitCaseEditor(event: FormEvent, item: InboxItem) {
    event.preventDefault();
    if (!caseEditor || caseEditor.itemId !== item.id) return;
    const value = caseEditor.value.trim();
    if (!value) return;
    const saved = await updateItem(
      item,
      caseEditor.mode === "resolve" ? "resolved" : item.status,
      caseEditor.mode === "resolve" ? { reason: value } : { privateNote: value },
    );
    if (saved) setCaseEditor(undefined);
  }

  async function setItemRead(item: InboxItem, read: boolean, reload = true) {
    const response = await authFetch("/api/admin/operations/inbox", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: item.id, read }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      onError(body.error ?? "Notification read state could not be updated");
      return false;
    }
    if (reload) await loadInbox();
    return true;
  }

  async function openItem(item: InboxItem) {
    if (item.unread) await setItemRead(item, true, false);
    window.location.assign(item.deepLink);
  }

  async function saveView() {
    const name = (
      await prompt({
        eyebrow: "inbox filters",
        title: "Save this view",
        description: "The current filters will be kept on this device.",
        label: "view name",
        required: true,
        confirmLabel: "save view",
        validate: (value) =>
          value.trim().length > 80 ? "Keep the name under 80 characters." : null,
      })
    )?.trim();
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
    try {
      window.localStorage.setItem("attendee-operations-inbox-views", JSON.stringify(next));
      setSavedViews(next);
      onStatus("Inbox view saved on this device.");
    } catch {
      onError("This browser could not save the inbox view.");
    }
  }

  const loadPeople = useCallback(
    async (selectedPersonId?: string, searchText = query) => {
      setLoading(true);
      setPeopleLoadError(null);
      try {
        const response = await authFetch(
          `/api/admin/operations/people?q=${encodeURIComponent(searchText)}`,
        );
        const body = (await response.json()) as {
          people?: Person[];
          purchaserContacts?: PurchaserContact[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "People could not be searched");
        const nextPeople = body.people ?? [];
        const nextContacts = body.purchaserContacts ?? [];
        setPeople(nextPeople);
        setPurchaserContacts(nextContacts);
        const matchingPerson = selectedPersonId
          ? nextPeople.find((person) => person.personId === selectedPersonId)
          : searchText
            ? nextPeople[0]
            : undefined;
        setSelected(matchingPerson);
        setSelectedContact(
          matchingPerson || !searchText
            ? undefined
            : (nextContacts.find((contact) =>
                contact.tickets.some((ticket) => ticket.id === searchText),
              ) ?? nextContacts[0]),
        );
        setPeopleLoaded(true);
        if (matchingPerson && matchingPerson.personId !== initialPerson) {
          selfNavigationRef.current = matchingPerson.personId;
          onPersonChange(matchingPerson.personId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "People could not be searched";
        setPeopleLoadError(message);
        onError(message);
      } finally {
        setLoading(false);
      }
    },
    [authFetch, initialPerson, onError, onPersonChange, query],
  );

  // Seeds the search from deep-link parameters only. `loadPeople` is read
  // through a ref: its identity tracks the query text, and depending on it
  // here made every keystroke re-run this effect and stomp the box with the
  // deep-link target while re-fetching three or four times per search.
  const loadPeopleRef = useRef(loadPeople);
  loadPeopleRef.current = loadPeople;
  const selfNavigationRef = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "people") return;
    const selfTarget = selfNavigationRef.current;
    selfNavigationRef.current = null;
    // Navigation this panel initiated itself (a result click, a drawer close)
    // already updated local state; re-seeding would overwrite what the admin
    // typed with the resolved person id and fire a redundant search.
    if (selfTarget !== null && (initialPerson ?? "cleared") === selfTarget) return;
    const target = initialPerson ?? initialTicket ?? initialEvent ?? "";
    setQuery(target);
    void loadPeopleRef.current(initialPerson, target);
  }, [initialEvent, initialPerson, initialTicket, tab]);

  async function findPeople(event: FormEvent) {
    event.preventDefault();
    await loadPeople();
  }

  async function manageIdentity(
    person: Person,
    action:
      | "sign-out"
      | "restrict"
      | "restore"
      | "remove-email"
      | "grant-transfer-creator"
      | "revoke-transfer-creator",
    identifierId?: string,
  ) {
    const label =
      action === "sign-out"
        ? "sign this person out on every device"
        : action === "grant-transfer-creator"
          ? "allow this account to create file transfers"
          : action === "revoke-transfer-creator"
            ? "remove file-transfer creation access from this account"
            : action === "remove-email"
              ? "remove this email as a sign-in identity and sign this person out everywhere"
              : action === "restrict"
                ? "prevent this person from buying new tickets or receiving new staff/admin permissions"
                : "allow this person to acquire new tickets and permissions again";
    const reason = (
      await prompt({
        eyebrow: "identity access",
        title: `${label.charAt(0).toUpperCase()}${label.slice(1)}?`,
        description:
          action === "grant-transfer-creator"
            ? "They can use their normal account sign-in to create transfers and manage transfers they own."
            : action === "restore"
              ? "The person will be able to acquire new tickets and permissions again."
              : "This takes effect immediately and is recorded in the audit timeline.",
        label: "reason for the audit log",
        required: true,
        confirmLabel:
          action === "restore"
            ? "restore access"
            : action === "grant-transfer-creator"
              ? "grant transfer access"
              : action === "revoke-transfer-creator"
                ? "revoke transfer access"
                : action === "sign-out"
                  ? "sign out everywhere"
                  : action === "remove-email"
                    ? "remove sign-in"
                    : "restrict access",
        intent: action === "restore" || action === "grant-transfer-creator" ? "default" : "danger",
        validate: (value) =>
          value.trim().length < 3 ? "Enter a reason of at least 3 characters." : null,
      })
    )?.trim();
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
          : action === "grant-transfer-creator"
            ? "This account can now create and manage its own file transfers."
            : action === "revoke-transfer-creator"
              ? "File-transfer creation access revoked. Existing owned transfers remain manageable."
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
    <section
      id={inboxOnly ? "notifications" : undefined}
      aria-labelledby="attendee-operations-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b theme-border pb-5">
        <div>
          <p className="font-mono text-micro uppercase tracking-widest theme-muted">
            {inboxOnly ? "across the app" : "attendee operations"}
          </p>
          <h2 id="attendee-operations-heading" className="mt-2 font-serif text-3xl">
            {inboxOnly
              ? "Notifications"
              : tab === "people"
                ? "Identity manager"
                : tab === "preview"
                  ? "Attendee experience"
                  : "People who need an answer"}
          </h2>
        </div>
        {tab === "inbox" && inboxLoaded && !inboxLoadError ? (
          <p className="font-mono text-xs theme-muted">
            {unresolved} unresolved · {unread} unread for you
          </p>
        ) : null}
      </div>
      {!inboxOnly ? (
        <div className="mt-4 flex gap-5 border-b theme-border">
          {availableTabs.map((name) => (
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
                ? `needs attention${inboxLoaded && !inboxLoadError && unresolved ? ` · ${unresolved}` : ""}`
                : name === "people"
                  ? "identity manager"
                  : "attendee preview"}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="mt-5">
          <div className="mb-5 grid gap-3 border-y theme-border py-4 sm:grid-cols-2 lg:grid-cols-5">
            <AppSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={[
                { value: "", label: "all statuses" },
                ...(["new", "in-progress", "resolved", "dismissed"] as const).map((status) => ({
                  value: status,
                  label: status,
                })),
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
              onClick={() => void saveView()}
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
          {inboxLoadError ? (
            <AdminLoadError
              message={inboxLoadError}
              retry={() => void loadInbox()}
              retrying={loading}
            />
          ) : !inboxLoaded ? (
            <AdminLoading label="Loading the operations inbox…" />
          ) : items.length === 0 ? (
            <p className="border-y theme-border py-5 font-mono text-xs theme-muted">
              Nothing needs attention.
            </p>
          ) : (
            <ol className="divide-y border-y theme-border">
              {items.map((item) => (
                <li key={item.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-2xl">
                      <div className="flex flex-wrap items-center gap-x-2 font-mono text-micro uppercase tracking-widest theme-muted">
                        <AdminStatus
                          tone={
                            item.severity === "critical"
                              ? "danger"
                              : item.status === "resolved"
                                ? "positive"
                                : item.status === "in-progress" ||
                                    item.unread ||
                                    item.severity === "warning" ||
                                    item.severity === "prompt"
                                  ? "attention"
                                  : "neutral"
                          }
                        >
                          {item.status}
                          {item.unread ? " · unread" : ""}
                        </AdminStatus>
                        <span>
                          · {item.severity} · {item.category}
                        </span>
                        {item.eventSlug ? <span>· {item.eventSlug}</span> : null}
                      </div>
                      <h3 className="mt-1 font-serif text-xl">{item.title}</h3>
                      <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
                        {item.body}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div
                        role="group"
                        aria-label="Notification actions"
                        className="flex flex-wrap items-center gap-x-4 gap-y-1"
                      >
                        <a
                          href={item.deepLink}
                          onClick={(event) => {
                            if (!item.unread) return;
                            event.preventDefault();
                            void openItem(item);
                          }}
                          className="min-h-11 py-3 font-mono text-xs underline hover:opacity-70"
                        >
                          open relevant page
                        </a>
                        <button
                          type="button"
                          onClick={() => void setItemRead(item, item.unread)}
                          className="min-h-11 font-mono text-xs underline"
                        >
                          {item.unread ? "mark read" : "mark unread"}
                        </button>
                      </div>
                      {item.caseId ? (
                        <div
                          role="group"
                          aria-label="Case actions"
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-l theme-border pl-4"
                        >
                          {item.status === "new" ? (
                            <button
                              type="button"
                              onClick={() => void updateItem(item, "in-progress")}
                              disabled={inboxBusy === item.id}
                              className="min-h-11 font-mono text-xs underline disabled:opacity-50"
                            >
                              start work
                            </button>
                          ) : null}
                          {administrators.length > 0 || item.assigneePersonId !== undefined ? (
                            <AppSelect
                              value={item.assigneePersonId ?? ""}
                              onValueChange={(value) =>
                                void updateItem(item, item.status, {
                                  assigneePersonId: value || null,
                                })
                              }
                              disabled={inboxBusy === item.id}
                              options={[
                                { value: "", label: "unassigned" },
                                ...(item.assigneePersonId &&
                                !administrators.some(
                                  (administrator) =>
                                    administrator.personId === item.assigneePersonId,
                                )
                                  ? [
                                      {
                                        value: item.assigneePersonId,
                                        label: item.assigneeName ?? "current assignee",
                                      },
                                    ]
                                  : []),
                                ...administrators.map((administrator) => ({
                                  value: administrator.personId,
                                  label: administrator.name,
                                })),
                              ]}
                              ariaLabel={`Assign ${item.title}`}
                            />
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              setCaseEditor((current) =>
                                current?.itemId === item.id && current.mode === "private-note"
                                  ? undefined
                                  : {
                                      itemId: item.id,
                                      mode: "private-note",
                                      value: item.privateNote?.body ?? "",
                                    },
                              )
                            }
                            disabled={inboxBusy === item.id}
                            aria-expanded={
                              caseEditor?.itemId === item.id && caseEditor.mode === "private-note"
                            }
                            aria-controls={`case-editor-${item.id}`}
                            className="min-h-11 font-mono text-xs underline disabled:opacity-50"
                          >
                            {item.privateNote?.body ? "edit private note" : "add private note"}
                          </button>
                          {!(["resolved", "dismissed"] as string[]).includes(item.status) ? (
                            <button
                              type="button"
                              onClick={() =>
                                setCaseEditor((current) =>
                                  current?.itemId === item.id && current.mode === "resolve"
                                    ? undefined
                                    : { itemId: item.id, mode: "resolve", value: "" },
                                )
                              }
                              disabled={inboxBusy === item.id}
                              aria-expanded={
                                caseEditor?.itemId === item.id && caseEditor.mode === "resolve"
                              }
                              aria-controls={`case-editor-${item.id}`}
                              className="min-h-11 font-mono text-xs underline disabled:opacity-50"
                            >
                              resolve
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {caseEditor?.itemId === item.id ? (
                    <form
                      id={`case-editor-${item.id}`}
                      onSubmit={(event) => void submitCaseEditor(event, item)}
                      className="mt-4 max-w-2xl border-t theme-border pt-4"
                    >
                      <label
                        htmlFor={`case-editor-value-${item.id}`}
                        className="font-mono text-xs font-bold"
                      >
                        {caseEditor.mode === "resolve" ? "resolution note" : "private note"}
                      </label>
                      <p
                        id={`case-editor-help-${item.id}`}
                        className="mt-1 font-mono text-micro theme-muted"
                      >
                        {caseEditor.mode === "resolve"
                          ? "Record what resolved the case. This is kept in the audit history."
                          : "Visible only to administrators. Saving replaces the previous private note."}
                      </p>
                      <textarea
                        id={`case-editor-value-${item.id}`}
                        value={caseEditor.value}
                        onChange={(event) =>
                          setCaseEditor((current) =>
                            current?.itemId === item.id
                              ? { ...current, value: event.target.value }
                              : current,
                          )
                        }
                        rows={3}
                        required
                        maxLength={2000}
                        autoFocus
                        aria-describedby={`case-editor-help-${item.id}`}
                        className="mt-3 w-full resize-y rounded border theme-border bg-transparent px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                      />
                      <div className="mt-3 flex flex-wrap gap-4">
                        <button
                          type="submit"
                          disabled={inboxBusy === item.id || !caseEditor.value.trim()}
                          className="min-h-11 rounded border theme-border-strong px-4 font-mono text-xs font-bold disabled:opacity-50"
                        >
                          {inboxBusy === item.id
                            ? "saving…"
                            : caseEditor.mode === "resolve"
                              ? "resolve case"
                              : "save private note"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCaseEditor(undefined)}
                          disabled={inboxBusy === item.id}
                          className="min-h-11 font-mono text-xs underline disabled:opacity-50"
                        >
                          cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
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
          {peopleLoadError ? (
            <div className="mt-5">
              <AdminLoadError
                message={peopleLoadError}
                retry={() => void loadPeople(initialPerson)}
                retrying={loading}
              />
            </div>
          ) : !peopleLoaded ? (
            <div className="mt-5">
              <AdminLoading label="Loading people…" />
            </div>
          ) : (
            <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
              <div className="space-y-6">
                <section aria-labelledby="identity-records-heading">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 id="identity-records-heading" className="font-mono text-xs font-bold">
                      identity records
                    </h3>
                    <span className="font-mono text-micro theme-muted">{people.length}</span>
                  </div>
                  <ul className="mt-2 divide-y border-y theme-border">
                    {people.map((person) => (
                      <li key={person.personId}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(person);
                            setSelectedContact(undefined);
                            selfNavigationRef.current = person.personId;
                            onPersonChange(person.personId);
                          }}
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
                    {!people.length ? (
                      <li className="py-4 font-mono text-xs theme-muted">
                        No identity record matches.
                      </li>
                    ) : null}
                  </ul>
                </section>
                <section aria-labelledby="purchaser-contacts-heading">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 id="purchaser-contacts-heading" className="font-mono text-xs font-bold">
                      purchasers not verified yet
                    </h3>
                    <span className="font-mono text-micro theme-muted">
                      {purchaserContacts.length}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-micro leading-relaxed theme-muted">
                    Purchase contacts appear immediately. They become identities only after mailbox
                    verification.
                  </p>
                  <ul className="mt-2 divide-y border-y theme-border">
                    {purchaserContacts.map((contact) => (
                      <li key={contact.contactId}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(undefined);
                            setSelectedContact(contact);
                          }}
                          className="min-h-14 w-full py-3 text-left hover:opacity-70"
                        >
                          <span className="block font-serif text-lg">
                            {contact.name ?? "Ticket purchaser"}
                          </span>
                          <span className="font-mono text-micro theme-muted">
                            {contact.emailHint} · {contact.tickets.length} tickets
                          </span>
                          {contact.tickets.some((ticket) => ticket.deliveryNeedsAttention) ? (
                            <AdminStatus
                              tone="danger"
                              className="mt-1 font-mono text-micro font-bold"
                            >
                              email delivery needs attention
                            </AdminStatus>
                          ) : null}
                        </button>
                      </li>
                    ))}
                    {!purchaserContacts.length ? (
                      <li className="py-4 font-mono text-xs theme-muted">
                        No unverified purchaser contact matches.
                      </li>
                    ) : null}
                  </ul>
                </section>
              </div>
              {selected ? (
                <PersonDrawer
                  person={selected}
                  busy={identityBusy}
                  onManage={manageIdentity}
                  onClose={() => {
                    setSelected(undefined);
                    selfNavigationRef.current = "cleared";
                    onPersonChange(undefined);
                  }}
                />
              ) : selectedContact ? (
                <PurchaserContactDrawer
                  contact={selectedContact}
                  onClose={() => setSelectedContact(undefined)}
                />
              ) : (
                <p className="font-mono text-xs theme-muted">
                  Choose a verified identity for access controls, or a purchaser contact for ticket
                  and delivery context.
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <AttendeePreviewMatrix />
        </div>
      )}
      {dialog}
    </section>
  );
}

function PurchaserContactDrawer({
  contact,
  onClose,
}: {
  contact: PurchaserContact;
  onClose: () => void;
}) {
  return (
    <aside className="border-y theme-border py-5" aria-label="Purchaser contact detail">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          purchaser contact
        </p>
        <button type="button" onClick={onClose} className="mh-action mh-action--quiet">
          close
        </button>
      </div>
      <h3 className="mt-2 font-serif text-2xl">{contact.name ?? "Ticket purchaser"}</h3>
      <p className="mt-1 font-mono text-xs theme-muted">{contact.emailHint}</p>
      <div className="mt-5 border-y theme-border py-4">
        <AdminStatus tone="attention" className="font-mono text-xs">
          Not an account yet
        </AdminStatus>
        <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
          Buying a ticket records the delivery contact but does not prove control of the mailbox.
          After a successful one-time-link sign-in, the verified identity appears here and eligible
          orders become recoverable without changing the ticket links.
        </p>
      </div>
      <h4 className="mt-6 font-mono text-xs font-bold">purchased tickets</h4>
      <ul className="mt-2 divide-y border-y theme-border">
        {contact.tickets.map((ticket) => (
          <li key={ticket.id} className="py-4">
            <p className="font-serif text-lg">
              {ticket.eventTitle} · {ticket.holderName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
              <AdminStatus
                tone={ticket.status === "valid" ? "positive" : adminToneForStatus(ticket.status)}
              >
                {ticket.status}
              </AdminStatus>
              <span>
                · order {ticket.orderId} · purchased {new Date(ticket.issuedAt).toLocaleString()}
              </span>
            </div>
            {ticket.deliveryNeedsAttention ? (
              <AdminStatus tone="danger" className="mt-2 font-mono text-xs font-bold">
                Email {ticket.deliveryStatus?.replaceAll("-", " ") ?? "failed"} · resolve before
                sending again
              </AdminStatus>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-4">
              <Link
                to="/ticket/$id"
                params={{ id: ticket.id }}
                search={{ preview: true }}
                className="mh-action mh-action--quiet"
              >
                preview ticket
              </Link>
              <Link
                to="/admin"
                search={{ view: "events", event: ticket.eventSlug }}
                className="mh-action mh-action--quiet"
              >
                manage event tickets
              </Link>
              <Link
                to="/admin"
                search={{
                  view: "communications",
                  communicationTab: "delivery",
                  emailQuery: ticket.id,
                }}
                className="mh-action mh-action--quiet"
              >
                {ticket.deliveryNeedsAttention ? "resolve email delivery" : "view email delivery"}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function PersonDrawer({
  person,
  busy,
  onManage,
  onClose,
}: {
  person: Person;
  busy: boolean;
  onManage: (
    person: Person,
    action:
      | "sign-out"
      | "restrict"
      | "restore"
      | "remove-email"
      | "grant-transfer-creator"
      | "revoke-transfer-creator",
    identifierId?: string,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const recentlyActive =
    person.access.lastSeenAt !== undefined &&
    Date.now() - Date.parse(person.access.lastSeenAt) < 5 * 60 * 1_000;
  const verifiedIdentityCount = person.identities.filter(
    (identity) => identity.status === "verified",
  ).length;
  const canCreateTransfers = person.accountPermissions.includes("create_transfers");
  return (
    <aside className="border-y theme-border py-5" aria-label="Attendee detail">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          identity manager
        </p>
        <button type="button" onClick={onClose} className="mh-action mh-action--quiet">
          close
        </button>
      </div>
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
                    <AdminStatus
                      tone={
                        identity.status === "verified"
                          ? "positive"
                          : identity.status === "pending"
                            ? "attention"
                            : "neutral"
                      }
                      className="ml-2"
                    >
                      {identity.status}
                    </AdminStatus>
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
          <dt className="theme-muted">file transfers</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-3">
            <AdminStatus tone={canCreateTransfers ? "positive" : "neutral"}>
              {canCreateTransfers ? "can create transfers" : "no account access"}
            </AdminStatus>
            <button
              type="button"
              disabled={
                busy || (!canCreateTransfers && person.access.acquisitionStatus !== "active")
              }
              onClick={() =>
                void onManage(
                  person,
                  canCreateTransfers ? "revoke-transfer-creator" : "grant-transfer-creator",
                )
              }
              className={
                canCreateTransfers
                  ? "mh-action mh-action--danger disabled:opacity-40"
                  : "mh-action mh-action--secondary disabled:opacity-40"
              }
            >
              {canCreateTransfers ? "revoke access" : "grant access"}
            </button>
          </dd>
        </div>
        <div>
          <dt className="theme-muted">sessions</dt>
          <dd className="mt-1">
            <AdminStatus tone={person.access.activeSessions > 0 ? "positive" : "neutral"}>
              {person.access.activeSessions} active session
              {person.access.activeSessions === 1 ? "" : "s"}
              {recentlyActive ? " · active in the last 5 minutes" : ""}
            </AdminStatus>
          </dd>
          {person.access.lastSeenAt ? (
            <dd className="mt-1 theme-muted">
              last seen {new Date(person.access.lastSeenAt).toLocaleString()}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="theme-muted">new tickets and permissions</dt>
          <dd className="mt-1">
            <AdminStatus
              tone={person.access.acquisitionStatus === "active" ? "positive" : "danger"}
            >
              {person.access.acquisitionStatus}
            </AdminStatus>
          </dd>
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
          <dd className="mt-1 flex flex-wrap items-center gap-x-2">
            <span>{person.staffDevices} staff devices</span>
            <span aria-hidden="true">·</span>
            <AdminStatus tone={person.pendingInvitations > 0 ? "attention" : "neutral"}>
              {person.pendingInvitations} pending
            </AdminStatus>
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
            <Link
              to="/ticket/$id"
              params={{ id: ticket.id }}
              search={{ preview: true }}
              className="font-mono text-xs underline hover:opacity-70"
            >
              {ticket.eventTitle} · {ticket.holderName}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
              <AdminStatus
                tone={ticket.status === "valid" ? "positive" : adminToneForStatus(ticket.status)}
              >
                {ticket.status}
              </AdminStatus>
              <span>· order {ticket.orderId}</span>
            </div>
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
                <dd className="flex flex-wrap items-center gap-x-2">
                  <span>{ticket.communication.total} sent</span>
                  <span aria-hidden="true">·</span>
                  <AdminStatus tone={ticket.communication.failed > 0 ? "danger" : "positive"}>
                    {ticket.communication.failed} failed
                  </AdminStatus>
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
