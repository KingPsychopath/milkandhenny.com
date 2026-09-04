"use client";

import {
  EventOperations,
  parseEventTicketSummary,
  type EventTicketSummary,
} from "./EventOperationsPanel";
export { TicketSalesBreakdown } from "./EventOperationsPanel";
import { AdminTextField as Field } from "./AdminTextField";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useAdminDraftState } from "../hooks/useAdminDraftState";
import { EMPTY_DRAFT, toDraft, draftToPayload, type Draft } from "./event-editor-state";
import { AppSelect } from "@/components/AppSelect";
import { AppImage } from "@/components/AppImage";
import { useActionDialog } from "@/hooks/useActionDialog";

import type { GlobalAdminPermissionSet } from "@/features/attendee-operations/types";
import {
  EVENT_HERO_HEIGHTS,
  EVENT_STATUSES,
  formatEventDateTime,
  heroImageHeightClass,
  isEventHeroHeight,
  isEventStatus,
  type EventHeroHeight,
  type EventRecord,
} from "@/features/events/types";
import { AdminFormAction } from "./AdminFormAction";
import { FooterPartyLinkSettings } from "./FooterPartyLinkSettings";

import { AdminStatus } from "./AdminStatus";
import { pickDefaultAdminEvent } from "./event-admin-selection";

const HERO_HEIGHT_LABELS: Record<EventHeroHeight, string> = {
  natural: "natural — the image's own height",
  tall: "tall — 70% of the screen",
  medium: "medium — 45% of the screen",
  short: "short — 28% of the screen",
};

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Event management.
 *
 * Kept as a self-contained panel rather than appended to AdminDashboard,
 * which is already 2,300 lines. Follows the ReportsPanel contract so it
 * drops into the dashboard with the same three props.
 */

type EventsWorkspaceSelection =
  | { kind: "operations"; slug: string }
  | { kind: "edit"; slug: string }
  | { kind: "create" }
  | null;

function waitlistRelevantEventChange(
  existing: EventRecord,
  payload: Record<string, unknown>,
): boolean {
  if (
    payload.status !== existing.status ||
    payload.capacity !== (existing.capacity ?? null) ||
    payload.waitlistEnabled !== existing.waitlistEnabled
  ) {
    return true;
  }
  const nextTypes = Array.isArray(payload.ticketTypes) ? payload.ticketTypes : [];
  const existingShape = existing.ticketTypes.map((type) => ({
    id: type.id,
    quantity: type.quantity,
    hidden: type.hidden,
    salesStart: type.salesStart ?? null,
    salesEnd: type.salesEnd ?? null,
  }));
  const nextShape = nextTypes.map((value) => {
    const type = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const record = type as Record<string, unknown>;
    return {
      id: record.id,
      quantity: record.quantity,
      hidden: record.hidden,
      salesStart: record.salesStart ?? null,
      salesEnd: record.salesEnd ?? null,
    };
  });
  return JSON.stringify(existingShape) !== JSON.stringify(nextShape);
}

export function EventsPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
  initialEventSlug,
  onSelectedEventChange,
  permissions,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<
    { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
  >;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
  initialEventSlug?: string;
  onSelectedEventChange?: (eventSlug?: string) => void;
  permissions: GlobalAdminPermissionSet;
}) {
  const statusId = useId();
  const heroHeightId = useId();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const editorErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (editorError) editorErrorRef.current?.focus();
  }, [editorError]);
  const [editor, setEditor] = useAdminDraftState<{
    selection: EventsWorkspaceSelection;
    draft: Draft | null;
  }>("event-editor", { selection: null, draft: null }, (value) => value.draft !== null);
  const { selection, draft } = editor;
  const setSelection = useCallback(
    (selection: EventsWorkspaceSelection) => setEditor((current) => ({ ...current, selection })),
    [setEditor],
  );
  const setDraft = useCallback(
    (draft: React.SetStateAction<Draft | null>) =>
      setEditor((current) => ({
        ...current,
        draft: typeof draft === "function" ? draft(current.draft) : draft,
      })),
    [setEditor],
  );
  const [operations, setOperations] = useState<EventTicketSummary | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const openedTarget = useRef<string | undefined>(undefined);
  const appliedDefaultSelection = useRef(false);
  const operationsRequest = useRef(0);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const eventWorkspaceTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusSlug = useRef<string | null>(null);
  const returnFocusViewportTop = useRef<number | null>(null);
  const { confirm, prompt, dialog } = useActionDialog();
  const editing =
    selection?.kind === "create" ? "__new__" : selection?.kind === "edit" ? selection.slug : null;
  const operationsSlug = selection?.kind === "operations" ? selection.slug : null;
  const selectedEvent =
    selection?.kind === "edit" || selection?.kind === "operations"
      ? events.find((event) => event.slug === selection.slug)
      : null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    onError("");
    try {
      const response = await authFetch("/api/admin/events");
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Failed to load events");
      const list =
        data && typeof data === "object" && "events" in data && Array.isArray(data.events)
          ? (data.events as EventRecord[])
          : [];
      setEvents(list);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load events";
      setLoadError(message);
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let settleFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => {
        if (selection) {
          const heading = workspaceHeadingRef.current;
          if (!heading) return;
          heading.focus({ preventScroll: true });
          const targetTop = returnFocusViewportTop.current;
          if (selection.kind === "operations" && targetTop !== null) {
            window.scrollBy(0, heading.getBoundingClientRect().top - targetTop);
          } else {
            heading.scrollIntoView({ block: "nearest" });
          }
          return;
        }

        const slug = returnFocusSlug.current;
        if (!slug) return;
        const trigger = eventWorkspaceTriggerRefs.current.get(slug);
        if (!trigger) return;
        const targetTop = returnFocusViewportTop.current;
        returnFocusSlug.current = null;
        returnFocusViewportTop.current = null;
        trigger.focus({ preventScroll: true });
        if (targetTop !== null) {
          window.scrollBy(0, trigger.getBoundingClientRect().top - targetTop);
        } else {
          trigger.scrollIntoView({ block: "nearest" });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [operationsLoading, selection]);

  const loadOperations = useCallback(
    async (slug: string) => {
      const response = await authFetch(`/api/admin/events/${slug}`);
      const data: unknown = await response.json().catch(() => null);
      const summary =
        data && typeof data === "object" && !Array.isArray(data) && "tickets" in data
          ? parseEventTicketSummary(data.tickets)
          : null;
      if (!response.ok || !summary) throw new Error("Failed to load event operations");
      return summary;
    },
    [authFetch],
  );

  const canReplaceDraft = async () =>
    !draft ||
    (await confirm({
      title: "Discard unfinished event edits?",
      description:
        "Continue editing to keep this draft, or discard it before opening another event.",
      confirmLabel: "discard edits",
      cancelLabel: "keep editing",
      intent: "danger",
    }));

  const toggleOperations = async (slug: string) => {
    if (!(await canReplaceDraft())) return;
    onSelectedEventChange?.(operationsSlug === slug ? undefined : slug);
    if (operationsSlug === slug) {
      operationsRequest.current += 1;
      setSelection(null);
      setOperations(null);
      setOperationsError(null);
      setOperationsLoading(false);
      return;
    }

    const triggerTop = eventWorkspaceTriggerRefs.current.get(slug)?.getBoundingClientRect().top;
    returnFocusSlug.current = slug;
    returnFocusViewportTop.current =
      triggerTop === undefined ? 96 : Math.min(180, Math.max(96, triggerTop));
    setSelection({ kind: "operations", slug });
    setDraft(null);
    setOperations(null);
    setOperationsError(null);
    setOperationsLoading(true);
    onError("");
    const request = ++operationsRequest.current;
    try {
      const summary = await loadOperations(slug);
      if (request === operationsRequest.current) setOperations(summary);
    } catch (error) {
      if (request !== operationsRequest.current) return;
      const message = error instanceof Error ? error.message : "Failed to load event operations";
      setOperationsError(message);
      onError(message);
    } finally {
      if (request === operationsRequest.current) setOperationsLoading(false);
    }
  };

  const retryOperations = async (slug: string) => {
    setOperations(null);
    setOperationsError(null);
    setOperationsLoading(true);
    onError("");
    const request = ++operationsRequest.current;
    try {
      const summary = await loadOperations(slug);
      if (request === operationsRequest.current) setOperations(summary);
    } catch (error) {
      if (request !== operationsRequest.current) return;
      const message = error instanceof Error ? error.message : "Failed to load event operations";
      setOperationsError(message);
      onError(message);
    } finally {
      if (request === operationsRequest.current) setOperationsLoading(false);
    }
  };

  useEffect(() => {
    if (
      draft !== null ||
      !initialEventSlug ||
      openedTarget.current === initialEventSlug ||
      !events.some((event) => event.slug === initialEventSlug)
    ) {
      return;
    }
    openedTarget.current = initialEventSlug;
    setSelection({ kind: "operations", slug: initialEventSlug });
    setDraft(null);
    setOperations(null);
    setOperationsError(null);
    setOperationsLoading(true);
    const request = ++operationsRequest.current;
    void loadOperations(initialEventSlug)
      .then((summary) => {
        if (request === operationsRequest.current) setOperations(summary);
      })
      .catch((error) => {
        if (request !== operationsRequest.current) return;
        const message = error instanceof Error ? error.message : "Failed to load event operations";
        setOperationsError(message);
        onError(message);
      })
      .finally(() => {
        if (request === operationsRequest.current) setOperationsLoading(false);
      });
  }, [draft, events, initialEventSlug, loadOperations, onError, setDraft, setSelection]);

  useEffect(() => {
    if (
      draft !== null ||
      initialEventSlug ||
      appliedDefaultSelection.current ||
      loading ||
      loadError ||
      events.length === 0
    ) {
      return;
    }
    appliedDefaultSelection.current = true;
    const preferred = pickDefaultAdminEvent(events);
    if (!preferred) return;
    setSelection({ kind: "operations", slug: preferred.slug });
    setDraft(null);
    setOperations(null);
    setOperationsError(null);
    setOperationsLoading(true);
    const request = ++operationsRequest.current;
    void loadOperations(preferred.slug)
      .then((summary) => {
        if (request === operationsRequest.current) setOperations(summary);
      })
      .catch((error) => {
        if (request !== operationsRequest.current) return;
        const message = error instanceof Error ? error.message : "Failed to load event operations";
        setOperationsError(message);
        onError(message);
      })
      .finally(() => {
        if (request === operationsRequest.current) setOperationsLoading(false);
      });
  }, [
    draft,
    events,
    initialEventSlug,
    loadError,
    loadOperations,
    loading,
    onError,
    setDraft,
    setSelection,
  ]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    onError("");
    try {
      const payload = draftToPayload(draft);
      const isNew = editing === "__new__";
      const existing = isNew ? undefined : events.find((event) => event.slug === editing);
      const cancelling =
        !isNew && existing?.status !== "cancelled" && payload.status === "cancelled";
      if (!isNew && existing && !cancelling && waitlistRelevantEventChange(existing, payload)) {
        const previewResponse = await authFetch(`/api/admin/events/${editing}/waitlist`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", event: payload }),
        });
        const preview: unknown = await previewResponse.json().catch(() => null);
        if (!previewResponse.ok) {
          const message =
            preview &&
            typeof preview === "object" &&
            !Array.isArray(preview) &&
            "error" in preview &&
            typeof preview.error === "string"
              ? preview.error
              : "Could not check the waitlist impact";
          throw new Error(message);
        }
        const impact =
          preview &&
          typeof preview === "object" &&
          !Array.isArray(preview) &&
          "count" in preview &&
          typeof preview.count === "number"
            ? (preview as {
                count: number;
                scopes?: Array<{ label: string; count: number }>;
              })
            : null;
        if (impact && impact.count > 0) {
          const detail = (impact.scopes ?? [])
            .map((scope) => `${scope.count} for ${scope.label}`)
            .join(" · ");
          const confirmed = await confirm({
            title: `Notify ${impact.count} waitlisted ${impact.count === 1 ? "person" : "people"}?`,
            description: `${detail ? `${detail}. ` : ""}Saving this availability change queues one email for each person. Tickets are not reserved for them.`,
            confirmLabel: "save and notify",
            intent: "default",
          });
          if (!confirmed) return;
        }
      }
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cancelling) {
        const cancellationReason = await prompt({
          eyebrow: "event cancellation",
          title: `Cancel “${existing?.title ?? "this event"}”?`,
          description:
            "Paid orders will be refunded to their original payment methods and current holders will be notified.",
          label: "Reason shown to attendees",
          confirmLabel: "cancel and refund",
          required: true,
        });
        if (!cancellationReason) return;
        const stepUp = await ensureStepUpToken();
        if (!stepUp.ok) {
          if (!stepUp.cancelled) onError(stepUp.error ?? "Step-up failed");
          return;
        }
        payload.cancellationReason = cancellationReason;
        headers = withStepUpHeaders(stepUp.token, headers);
      }
      const response = await authFetch(
        isNew ? "/api/admin/events" : `/api/admin/events/${editing}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers,
          body: JSON.stringify(payload),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to save event";
        throw new Error(message);
      }
      const waitlistNotifications =
        data &&
        typeof data === "object" &&
        "waitlistNotifications" in data &&
        typeof data.waitlistNotifications === "number"
          ? data.waitlistNotifications
          : 0;
      onStatus(
        isNew
          ? "Event created"
          : waitlistNotifications > 0
            ? `Event saved · ${waitlistNotifications} waitlist ${waitlistNotifications === 1 ? "email" : "emails"} queued`
            : "Event saved",
      );
      setSelection(null);
      setDraft(null);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save event";
      setEditorError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (event: EventRecord) => {
    const confirmed = await confirm({
      title: `Delete “${event.title}”?`,
      description: "Tickets already issued for this event will be orphaned. This cannot be undone.",
      confirmLabel: "delete event",
      intent: "danger",
    });
    if (!confirmed) return;

    const stepUp = await ensureStepUpToken();
    if (!stepUp.ok) {
      if (!stepUp.cancelled) onError(stepUp.error ?? "Step-up failed");
      return;
    }

    try {
      const response = await authFetch(`/api/admin/events/${event.slug}`, {
        method: "DELETE",
        headers: withStepUpHeaders(stepUp.token),
      });
      if (!response.ok) throw new Error("Failed to delete event");
      onStatus("Event deleted");
      if (selectedEvent?.slug === event.slug) {
        setSelection(null);
        setDraft(null);
        setOperations(null);
      }
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to delete event");
    }
  };

  return (
    <section id="events-manager" className="space-y-4 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs theme-muted">events</p>
        <div className="flex flex-wrap items-center gap-2">
          {permissions.manageEvents ? (
            <button
              type="button"
              onClick={async () => {
                if (!(await canReplaceDraft())) return;
                operationsRequest.current += 1;
                setSelection({ kind: "create" });
                setDraft(EMPTY_DRAFT);
                setOperations(null);
                setOperationsError(null);
                setOperationsLoading(false);
              }}
              className="inline-flex min-h-11 items-center rounded border theme-border px-3 font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              + new event
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center rounded border theme-border px-3 font-mono text-xs theme-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? "loading..." : "refresh"}
          </button>
        </div>
      </div>

      <div
        className={
          selection
            ? "lg:grid lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,2fr)] lg:gap-6"
            : undefined
        }
      >
        <div className={selection ? "hidden min-w-0 lg:block" : "min-w-0"}>
          {loading && events.length === 0 ? (
            <p role="status" className="py-4 font-mono text-xs theme-muted">
              loading events…
            </p>
          ) : null}

          {loadError ? (
            <div
              role="alert"
              className="my-3 border-l-2 border-[var(--admin-danger)] py-1 pl-3 font-mono text-xs"
            >
              <p className="text-foreground">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="mt-2 min-h-11 theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
              >
                {loading ? "retrying…" : "retry loading events"}
              </button>
            </div>
          ) : null}

          {events.length === 0 && !loading && !loadError ? (
            <p className="py-4 font-mono text-xs theme-faint">no events yet</p>
          ) : null}

          <ul className="divide-y theme-border border-y theme-border">
            {events.map((event) => (
              <li
                key={event.slug}
                className={`py-3 ${selectedEvent?.slug === event.slug ? "border-l-2 border-[var(--prose-hashtag)] pl-3" : ""}`}
              >
                <div
                  className={
                    selection
                      ? "space-y-2"
                      : "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  }
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-foreground truncate">{event.title}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
                      <AdminStatus
                        tone={
                          event.status === "published"
                            ? "positive"
                            : event.status === "draft" || event.status === "sold-out"
                              ? "attention"
                              : "neutral"
                        }
                      >
                        {event.status}
                      </AdminStatus>
                      <span>
                        · {formatEventDateTime(event.startsAt, event.timezone)} ·{" "}
                        {event.ticketTypes.length} ticket type
                        {event.ticketTypes.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`flex flex-wrap items-center justify-start gap-2 ${selection ? "" : "sm:justify-end"}`}
                  >
                    <Link
                      to="/events/$slug"
                      params={{ slug: event.slug }}
                      className="inline-flex min-h-11 items-center px-2 font-mono text-micro theme-muted hover:opacity-70"
                    >
                      view
                    </Link>
                    <button
                      ref={(node) => {
                        if (node) eventWorkspaceTriggerRefs.current.set(event.slug, node);
                        else eventWorkspaceTriggerRefs.current.delete(event.slug);
                      }}
                      type="button"
                      onClick={() => void toggleOperations(event.slug)}
                      aria-expanded={operationsSlug === event.slug}
                      className="min-h-11 rounded border theme-border px-3 font-mono text-micro font-bold text-[var(--prose-hashtag)] hover:opacity-70"
                    >
                      {operationsSlug === event.slug
                        ? "close"
                        : permissions.manageEvents ||
                            permissions.manageTickets ||
                            permissions.executeRefunds ||
                            permissions.manageCommunications
                          ? "tickets & staff"
                          : "inspect"}
                    </button>
                    {permissions.manageEvents ? (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!(await canReplaceDraft())) return;
                            onSelectedEventChange?.(event.slug);
                            operationsRequest.current += 1;
                            setSelection({ kind: "edit", slug: event.slug });
                            setDraft(toDraft(event));
                            setOperations(null);
                            setOperationsError(null);
                            setOperationsLoading(false);
                          }}
                          aria-pressed={selection?.kind === "edit" && selection.slug === event.slug}
                          className="min-h-11 px-2 font-mono text-micro theme-muted underline hover:opacity-70"
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(event)}
                          className="min-h-11 px-2 font-mono text-micro text-[var(--prose-hashtag)] hover:opacity-70"
                        >
                          delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {permissions.manageGlobalSettings ? (
            <details className="group mt-6">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 border-y theme-border py-3 font-mono text-xs text-foreground marker:content-none hover:opacity-70">
                <span>public footer destination</span>
                <span className="theme-muted group-open:hidden">site-wide setting · open</span>
                <span className="hidden theme-muted group-open:inline">close</span>
              </summary>
              <FooterPartyLinkSettings events={events} onError={onError} onStatus={onStatus} />
            </details>
          ) : null}
        </div>

        {selection ? (
          <div
            className="min-w-0 scroll-mt-6 border-transparent theme-border lg:border-l lg:pl-6"
            aria-labelledby="event-workspace-title"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b theme-border pb-3">
              <div>
                <p className="font-mono text-micro theme-muted">
                  {selection.kind === "operations"
                    ? "tickets & staff"
                    : selection.kind === "create"
                      ? "new event"
                      : "event settings"}
                </p>
                <h3
                  ref={workspaceHeadingRef}
                  id="event-workspace-title"
                  tabIndex={-1}
                  className="mt-1 text-lg text-foreground focus:outline-none"
                >
                  {selection.kind === "create"
                    ? "Create an event"
                    : (selectedEvent?.title ?? "Event")}
                </h3>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!(await canReplaceDraft())) return;
                  onSelectedEventChange?.(undefined);
                  operationsRequest.current += 1;
                  setSelection(null);
                  setDraft(null);
                  setOperations(null);
                  setOperationsError(null);
                  setOperationsLoading(false);
                }}
                className="inline-flex min-h-11 items-center px-2 font-mono text-xs theme-muted underline underline-offset-4 hover:text-foreground"
              >
                ← back to events
              </button>
            </div>

            {operationsSlug && operationsLoading ? (
              <p role="status" className="py-4 font-mono text-xs theme-muted">
                loading event tools…
              </p>
            ) : null}

            {operationsSlug && operationsError ? (
              <div
                role="alert"
                className="border-l-2 border-[var(--admin-danger)] py-1 pl-3 font-mono text-xs"
              >
                <p className="text-foreground">{operationsError}</p>
                <button
                  type="button"
                  onClick={() => void retryOperations(operationsSlug)}
                  disabled={operationsLoading}
                  className="mt-2 min-h-11 theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                >
                  {operationsLoading ? "retrying…" : "retry event tools"}
                </button>
              </div>
            ) : null}

            {operationsSlug &&
            !operationsLoading &&
            !operationsError &&
            operations &&
            selectedEvent ? (
              <EventOperations
                key={selectedEvent.slug}
                event={selectedEvent}
                summary={operations}
                authFetch={authFetch}
                onError={onError}
                onStatus={onStatus}
                reload={async () => {
                  const request = ++operationsRequest.current;
                  const summary = await loadOperations(selectedEvent.slug);
                  if (request === operationsRequest.current) setOperations(summary);
                }}
                confirmAction={confirm}
                stepUp={{ ensureStepUpToken, withStepUpHeaders }}
                permissions={permissions}
              />
            ) : null}

            {permissions.manageEvents && draft ? (
              <form
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  setEditorError(null);
                  void save();
                }}
                className="space-y-4 border theme-border rounded-lg p-4"
              >
                <p className="font-mono text-xs theme-muted">
                  {editing === "__new__" ? "new event" : `editing ${editing}`}
                </p>

                {editorError ? (
                  <p
                    ref={editorErrorRef}
                    tabIndex={-1}
                    role="alert"
                    className="font-mono text-sm text-[var(--status-danger)]"
                  >
                    {editorError} Your draft is kept below.
                  </p>
                ) : null}
                <h4 className="font-mono text-xs font-bold">event essentials</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    required
                    label="title"
                    value={draft.title}
                    onChange={(value) => setDraft({ ...draft, title: value })}
                  />
                  <Field
                    label="slug"
                    value={draft.slug}
                    onChange={(value) => setDraft({ ...draft, slug: value })}
                    hint="blank = from title"
                  />
                  <Field
                    label="tagline"
                    value={draft.tagline}
                    onChange={(value) => setDraft({ ...draft, tagline: value })}
                  />
                  <div>
                    <label
                      htmlFor={statusId}
                      className="font-mono text-micro theme-muted tracking-wide"
                    >
                      status
                    </label>
                    <AppSelect
                      id={statusId}
                      value={draft.status}
                      onValueChange={(value) =>
                        isEventStatus(value) && setDraft({ ...draft, status: value })
                      }
                      options={EVENT_STATUSES.map((status) => ({ value: status, label: status }))}
                      variant="field"
                      className="mt-1 rounded text-sm"
                    />
                  </div>
                  <Field
                    required
                    label={`starts (${draft.timezone})`}
                    type="datetime-local"
                    value={draft.startsAt}
                    onChange={(value) => setDraft({ ...draft, startsAt: value })}
                  />
                  <Field
                    label={`doors (${draft.timezone})`}
                    type="datetime-local"
                    value={draft.doorsAt}
                    onChange={(value) => setDraft({ ...draft, doorsAt: value })}
                  />
                  <Field
                    label={`ends (${draft.timezone})`}
                    type="datetime-local"
                    value={draft.endsAt}
                    onChange={(value) => setDraft({ ...draft, endsAt: value })}
                  />
                  <Field
                    label="overall capacity"
                    type="number"
                    value={draft.capacity}
                    onChange={(value) => setDraft({ ...draft, capacity: value })}
                    hint="hard cap across every ticket type"
                  />
                  <Field
                    label="area (public)"
                    value={draft.area}
                    onChange={(value) => setDraft({ ...draft, area: value })}
                    hint="required to publish"
                  />
                  <Field
                    label="timezone"
                    value={draft.timezone}
                    onChange={(value) => setDraft({ ...draft, timezone: value })}
                  />
                </div>
                <h4 className="font-mono text-xs font-bold">venue and access</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="venue (ticket holders)"
                    value={draft.venueName}
                    onChange={(value) => setDraft({ ...draft, venueName: value })}
                  />
                  <Field
                    label="address (ticket holders)"
                    value={draft.address}
                    onChange={(value) => setDraft({ ...draft, address: value })}
                  />
                  <Field
                    label="door code"
                    value={draft.doorCode}
                    onChange={(value) => setDraft({ ...draft, doorCode: value })}
                  />
                  <Field
                    label="three-word hint"
                    value={draft.threeWordHint}
                    onChange={(value) => setDraft({ ...draft, threeWordHint: value })}
                  />
                  <Field
                    label="map URL"
                    value={draft.mapUrl}
                    onChange={(value) => setDraft({ ...draft, mapUrl: value })}
                  />
                  <Field
                    label="transport note"
                    value={draft.transportNote}
                    onChange={(value) => setDraft({ ...draft, transportNote: value })}
                  />
                  <Field
                    label="lineup"
                    value={draft.lineup}
                    onChange={(value) => setDraft({ ...draft, lineup: value })}
                    hint="comma separated"
                  />
                  <Field
                    label="age limit"
                    value={draft.ageLimit}
                    onChange={(value) => setDraft({ ...draft, ageLimit: value })}
                  />
                  <Field
                    label="dress code"
                    value={draft.dressCode}
                    onChange={(value) => setDraft({ ...draft, dressCode: value })}
                  />
                </div>
                <details className="border-t theme-border pt-2">
                  <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs font-bold">
                    publishing and images
                  </summary>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="hero image URL"
                      value={draft.heroImage}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          heroImage: value,
                          heroImageWidth: undefined,
                          heroImageHeight: undefined,
                        })
                      }
                      hint="shown at the top of the event page"
                    />
                    <div>
                      <label
                        htmlFor={heroHeightId}
                        className="font-mono text-micro theme-muted tracking-wide"
                      >
                        hero height
                      </label>
                      <AppSelect
                        id={heroHeightId}
                        value={draft.heroHeight}
                        onValueChange={(value) =>
                          isEventHeroHeight(value) && setDraft({ ...draft, heroHeight: value })
                        }
                        options={EVENT_HERO_HEIGHTS.map((height) => ({
                          value: height,
                          label: HERO_HEIGHT_LABELS[height],
                        }))}
                        variant="field"
                        className="mt-1 rounded text-sm"
                      />
                      <p className="mt-1 font-mono text-micro theme-faint">
                        anything but natural crops to a band, so the date and buy button stay above
                        the fold
                      </p>
                    </div>
                    <Field
                      label="social image URL"
                      value={draft.ogImage}
                      onChange={(value) => setDraft({ ...draft, ogImage: value })}
                      hint="optional; hero is used when blank"
                    />
                    <Field
                      label="marketing story path"
                      value={draft.marketingPath}
                      onChange={(value) => setDraft({ ...draft, marketingPath: value })}
                      hint="e.g. /pitch-night — links this event to its cinematic page"
                    />
                  </div>

                  {draft.heroImage && (
                    <div className="media-image-placeholder overflow-hidden rounded-lg">
                      <AppImage
                        src={draft.heroImage}
                        alt="Event hero preview"
                        width={draft.heroImageWidth}
                        height={draft.heroImageHeight}
                        reveal
                        onLoad={(event) => {
                          const { naturalWidth, naturalHeight } = event.currentTarget;
                          if (naturalWidth <= 0 || naturalHeight <= 0) return;
                          setDraft((current) =>
                            current &&
                            current.heroImage === draft.heroImage &&
                            (current.heroImageWidth !== naturalWidth ||
                              current.heroImageHeight !== naturalHeight)
                              ? {
                                  ...current,
                                  heroImageWidth: naturalWidth,
                                  heroImageHeight: naturalHeight,
                                }
                              : current,
                          );
                        }}
                        className={`w-full h-auto rounded-lg ${
                          draft.heroHeight === "natural"
                            ? "max-h-64 object-cover"
                            : heroImageHeightClass(draft.heroHeight)
                        }`}
                      />
                    </div>
                  )}

                  <Field
                    label="description (markdown)"
                    value={draft.description}
                    onChange={(value) => setDraft({ ...draft, description: value })}
                    rows={5}
                  />
                </details>
                <details className="border-t theme-border pt-2">
                  <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs font-bold">
                    policies and terms
                  </summary>
                  <div className="space-y-4">
                    <Field
                      label="house rules"
                      value={draft.houseRules}
                      onChange={(value) => setDraft({ ...draft, houseRules: value })}
                      rows={3}
                    />

                    <Field
                      label="refund policy"
                      value={draft.refundPolicy}
                      onChange={(value) => setDraft({ ...draft, refundPolicy: value })}
                      rows={3}
                    />

                    <Field
                      label="ticket terms"
                      value={draft.terms}
                      onChange={(value) => setDraft({ ...draft, terms: value })}
                      rows={4}
                      hint="Shown beside checkout; use clear entry, transfer, cancellation, and conduct terms."
                    />
                  </div>
                </details>
                <h4 className="font-mono text-xs font-bold">tickets and availability</h4>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft.stepFreeAccess}
                    onChange={(event) =>
                      setDraft({ ...draft, stepFreeAccess: event.target.checked })
                    }
                  />
                  <span className="font-mono text-micro theme-muted">step-free access</span>
                </label>

                <label className="flex min-h-11 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={draft.waitlistEnabled}
                    onChange={(event) =>
                      setDraft({ ...draft, waitlistEnabled: event.target.checked })
                    }
                    className="mt-0.5"
                  />
                  <span className="font-mono text-micro leading-relaxed theme-muted">
                    waitlist alerts enabled
                    <span className="block theme-faint">
                      Shows verified signup on sold-out tickets and sends one FIFO availability
                      alert per person.
                    </span>
                  </span>
                </label>

                <div className="space-y-3">
                  <p className="font-mono text-micro theme-muted tracking-wide">ticket types</p>
                  {draft.ticketTypes.map((type, index) => (
                    <div
                      key={`${type.id}-${index}`}
                      className="admin-form-row grid gap-2 border-t theme-border-faint pt-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
                    >
                      <Field
                        label="name"
                        value={type.name}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, name: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <Field
                        label="price £"
                        value={type.price}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, price: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <Field
                        label="quantity"
                        value={type.quantity}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, quantity: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <Field
                        label="per person"
                        value={type.perPersonLimit}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, perPersonLimit: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <AdminFormAction>
                        <button
                          type="button"
                          disabled={draft.ticketTypes.length === 1}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              ticketTypes: draft.ticketTypes.filter(
                                (_, ticketIndex) => ticketIndex !== index,
                              ),
                            })
                          }
                          className="min-h-11 px-2 font-mono text-micro text-[var(--prose-hashtag)] hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
                          title={
                            draft.ticketTypes.length === 1
                              ? "An event needs at least one ticket type."
                              : "Remove this ticket type when the event is saved."
                          }
                        >
                          remove
                        </button>
                      </AdminFormAction>
                      <Field
                        label="description"
                        value={type.description}
                        className="sm:col-span-2"
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, description: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <Field
                        label={`sales open (${draft.timezone})`}
                        type="datetime-local"
                        value={type.salesStart}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, salesStart: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <Field
                        label={`sales close (${draft.timezone})`}
                        type="datetime-local"
                        value={type.salesEnd}
                        onChange={(value) => {
                          const next = [...draft.ticketTypes];
                          next[index] = { ...type, salesEnd: value };
                          setDraft({ ...draft, ticketTypes: next });
                        }}
                      />
                      <label className="flex min-h-11 items-center gap-2 self-end font-mono text-micro theme-muted">
                        <input
                          type="checkbox"
                          checked={type.hidden}
                          onChange={(event) => {
                            const next = [...draft.ticketTypes];
                            next[index] = { ...type, hidden: event.target.checked };
                            setDraft({ ...draft, ticketTypes: next });
                          }}
                        />
                        hidden from sale
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        ticketTypes: [
                          ...draft.ticketTypes,
                          {
                            id: `type-${draft.ticketTypes.length + 1}`,
                            name: "",
                            description: "",
                            price: "0",
                            currency: "GBP",
                            quantity: "50",
                            perPersonLimit: "2",
                            salesStart: "",
                            salesEnd: "",
                            hidden: false,
                          },
                        ],
                      })
                    }
                    className="min-h-11 rounded border theme-border px-3 font-mono text-micro font-bold hover:opacity-70"
                  >
                    + add ticket type
                  </button>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-11 px-4 font-mono text-xs bg-foreground text-background rounded disabled:opacity-50"
                  >
                    {saving ? "saving..." : "save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null);
                      setDraft(null);
                    }}
                    className="min-h-11 px-2 font-mono text-xs theme-muted hover:text-foreground transition-colors"
                  >
                    cancel
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {dialog}
    </section>
  );
}
