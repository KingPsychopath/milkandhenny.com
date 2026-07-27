"use client";

import { useCallback, useEffect, useState } from "react";

import { useActionDialog } from "@/hooks/useActionDialog";
import {
  EVENT_STATUSES,
  formatEventDateTime,
  isEventStatus,
  type EventRecord,
  type EventStatus,
  type TicketType,
} from "@/features/events/types";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Event management.
 *
 * Kept as a self-contained panel rather than appended to AdminDashboard,
 * which is already 2,300 lines. Follows the ReportsPanel contract so it
 * drops into the dashboard with the same three props.
 */

type DraftTicketType = {
  id: string;
  name: string;
  price: string;
  quantity: string;
  perPersonLimit: string;
};

type Draft = {
  slug: string;
  title: string;
  tagline: string;
  status: EventStatus;
  startsAt: string;
  doorsAt: string;
  endsAt: string;
  timezone: string;
  area: string;
  venueName: string;
  address: string;
  doorCode: string;
  threeWordHint: string;
  mapUrl: string;
  description: string;
  lineup: string;
  dressCode: string;
  ageLimit: string;
  stepFreeAccess: boolean;
  capacity: string;
  refundPolicy: string;
  ticketTypes: DraftTicketType[];
};

const EMPTY_DRAFT: Draft = {
  slug: "",
  title: "",
  tagline: "",
  status: "draft",
  startsAt: "",
  doorsAt: "",
  endsAt: "",
  timezone: "Europe/London",
  area: "",
  venueName: "",
  address: "",
  doorCode: "",
  threeWordHint: "",
  mapUrl: "",
  description: "",
  lineup: "",
  dressCode: "",
  ageLimit: "",
  stepFreeAccess: false,
  capacity: "",
  refundPolicy: "",
  ticketTypes: [{ id: "standard", name: "Entry", price: "0", quantity: "50", perPersonLimit: "2" }],
};

/** `datetime-local` has no zone, so values round-trip through UTC explicitly. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toDraft(event: EventRecord): Draft {
  return {
    slug: event.slug,
    title: event.title,
    tagline: event.tagline ?? "",
    status: event.status,
    startsAt: toLocalInput(event.startsAt),
    doorsAt: toLocalInput(event.doorsAt),
    endsAt: toLocalInput(event.endsAt),
    timezone: event.timezone,
    area: event.area ?? "",
    venueName: event.venueName ?? "",
    address: event.address ?? "",
    doorCode: event.doorCode ?? "",
    threeWordHint: event.threeWordHint ?? "",
    mapUrl: event.mapUrl ?? "",
    description: event.description ?? "",
    lineup: event.lineup.join(", "),
    dressCode: event.dressCode ?? "",
    ageLimit: event.ageLimit ?? "",
    stepFreeAccess: event.stepFreeAccess === true,
    capacity: event.capacity ? String(event.capacity) : "",
    refundPolicy: event.refundPolicy ?? "",
    ticketTypes: event.ticketTypes.map((type) => ({
      id: type.id,
      name: type.name,
      price: String(type.priceMinor / 100),
      quantity: String(type.quantity),
      perPersonLimit: String(type.perPersonLimit),
    })),
  };
}

function draftToPayload(draft: Draft): Record<string, unknown> {
  const ticketTypes: Partial<TicketType>[] = draft.ticketTypes
    .filter((type) => type.name.trim())
    .map((type) => ({
      id:
        type.id.trim() ||
        type.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      name: type.name.trim(),
      priceMinor: Math.round((Number.parseFloat(type.price) || 0) * 100),
      currency: "GBP",
      quantity: Number.parseInt(type.quantity, 10) || 0,
      perPersonLimit: Number.parseInt(type.perPersonLimit, 10) || 1,
      hidden: false,
    }));

  return {
    slug: draft.slug.trim() || undefined,
    title: draft.title.trim(),
    tagline: draft.tagline.trim() || undefined,
    status: draft.status,
    startsAt: fromLocalInput(draft.startsAt),
    doorsAt: fromLocalInput(draft.doorsAt),
    endsAt: fromLocalInput(draft.endsAt),
    timezone: draft.timezone.trim(),
    area: draft.area.trim() || undefined,
    venueName: draft.venueName.trim() || undefined,
    address: draft.address.trim() || undefined,
    doorCode: draft.doorCode.trim() || undefined,
    threeWordHint: draft.threeWordHint.trim() || undefined,
    mapUrl: draft.mapUrl.trim() || undefined,
    description: draft.description.trim() || undefined,
    lineup: draft.lineup
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    dressCode: draft.dressCode.trim() || undefined,
    ageLimit: draft.ageLimit.trim() || undefined,
    stepFreeAccess: draft.stepFreeAccess,
    capacity: draft.capacity ? Number.parseInt(draft.capacity, 10) : undefined,
    refundPolicy: draft.refundPolicy.trim() || undefined,
    ticketTypes,
  };
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-micro theme-muted tracking-wide">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full min-h-10 px-3 font-mono text-sm bg-transparent border theme-border rounded text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
      />
      {hint && <span className="mt-1 block font-mono text-micro theme-faint">{hint}</span>}
    </label>
  );
}

export function EventsPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<
    { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
  >;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
}) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { confirm, dialog } = useActionDialog();

  const load = useCallback(async () => {
    setLoading(true);
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
      onError(error instanceof Error ? error.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    onError("");
    try {
      const payload = draftToPayload(draft);
      const isNew = editing === "__new__";
      const response = await authFetch(
        isNew ? "/api/admin/events" : `/api/admin/events/${editing}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
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
      onStatus(isNew ? "Event created" : "Event saved");
      setEditing(null);
      setDraft(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save event");
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
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to delete event");
    }
  };

  return (
    <section id="events-manager" className="space-y-4 scroll-mt-6">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs theme-muted">events</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setEditing("__new__");
              setDraft(EMPTY_DRAFT);
            }}
            className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
          >
            + new event
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="font-mono text-xs theme-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? "loading..." : "refresh"}
          </button>
        </div>
      </div>

      {events.length === 0 && !loading && (
        <p className="font-mono text-xs theme-faint py-4">no events yet</p>
      )}

      <ul className="divide-y theme-border border-y theme-border">
        {events.map((event) => (
          <li key={event.slug} className="py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-sm text-foreground truncate">{event.title}</p>
                <p className="font-mono text-micro theme-muted mt-0.5">
                  {event.status} · {formatEventDateTime(event.startsAt, event.timezone)} ·{" "}
                  {event.ticketTypes.length} ticket type
                  {event.ticketTypes.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-3">
                <a
                  href={`/events/${event.slug}`}
                  className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
                >
                  view
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(event.slug);
                    setDraft(toDraft(event));
                  }}
                  className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove(event)}
                  className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
                >
                  delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            void save();
          }}
          className="space-y-4 border theme-border rounded-lg p-4"
        >
          <p className="font-mono text-xs theme-muted">
            {editing === "__new__" ? "new event" : `editing ${editing}`}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
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
            <label className="block">
              <span className="font-mono text-micro theme-muted tracking-wide">status</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  isEventStatus(event.target.value) &&
                  setDraft({ ...draft, status: event.target.value })
                }
                className="mt-1 w-full min-h-10 px-3 font-mono text-sm bg-transparent border theme-border rounded text-foreground"
              >
                {EVENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="starts"
              type="datetime-local"
              value={draft.startsAt}
              onChange={(value) => setDraft({ ...draft, startsAt: value })}
            />
            <Field
              label="doors"
              type="datetime-local"
              value={draft.doorsAt}
              onChange={(value) => setDraft({ ...draft, doorsAt: value })}
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
          </div>

          <label className="block">
            <span className="font-mono text-micro theme-muted tracking-wide">
              description (markdown)
            </span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={5}
              className="mt-1 w-full px-3 py-2 font-mono text-sm bg-transparent border theme-border rounded text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.stepFreeAccess}
              onChange={(event) => setDraft({ ...draft, stepFreeAccess: event.target.checked })}
            />
            <span className="font-mono text-micro theme-muted">step-free access</span>
          </label>

          <div className="space-y-3">
            <p className="font-mono text-micro theme-muted tracking-wide">ticket types</p>
            {draft.ticketTypes.map((type, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4 items-end">
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
                      price: "0",
                      quantity: "50",
                      perPersonLimit: "2",
                    },
                  ],
                })
              }
              className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
            >
              + add ticket type
            </button>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-10 px-4 font-mono text-xs bg-foreground text-background rounded disabled:opacity-50"
            >
              {saving ? "saving..." : "save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(null);
              }}
              className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
            >
              cancel
            </button>
          </div>
        </form>
      )}

      {dialog}
    </section>
  );
}
