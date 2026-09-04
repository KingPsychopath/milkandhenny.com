"use client";

import { AdminTextField as Field } from "./AdminTextField";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { AppImage } from "@/components/AppImage";

import { useQrCode } from "@/hooks/useQrCode";
import { useAdminAutoRefresh } from "@/features/admin/ui/hooks/useAdminAutoRefresh";
import type { GlobalAdminPermissionSet } from "@/features/attendee-operations/types";
import { formatMoney, type EventRecord } from "@/features/events/types";
import {
  SCANNER_PERMISSIONS,
  SCANNER_PERMISSION_LABELS,
  scannerPath,
  type CheckpointRecord,
  type GuestRequestRecord,
  type ScannerLinkRecord,
} from "@/features/tickets/checkpoint-types";
import type { DoorTicketView } from "@/features/tickets/types";
import { AdminFormAction } from "./AdminFormAction";
import { EventWaitlistPanel } from "./EventWaitlistPanel";
import { EventStaffAccessPanel } from "./EventStaffAccessPanel";
import type { AdminStaffAssignment, AdminStaffRole, StaffAccessAction } from "./staff-access-types";
import {
  AdminStatus,
  adminToneBorderClass,
  adminToneForStatus,
  adminToneTextClass,
} from "./AdminStatus";

type AdminTicket = DoorTicketView & {
  ticketTypeId: string;
  email?: string;
  issuedAt: string;
  refundedAt?: string;
  amountPaidMinor?: number;
  currency?: string;
  activeExchange?: {
    status: "processing" | "awaiting_payment" | "refund_pending";
    toTicketTypeId: string;
    toTicketTypeName: string;
    errorMessage?: string;
  };
};

type TicketListFilter = "all" | "valid" | "checked-in" | "not-checked-in" | "refunded" | "void";
type TicketListSort = "newest" | "oldest" | "name" | "status";
type EventOperationsTool = "overview" | "tickets" | "waitlist" | "door" | "messages" | "uploads";
const TICKET_FILTER_OPTIONS = [
  { value: "all", label: "all tickets" },
  { value: "valid", label: "live tickets" },
  { value: "checked-in", label: "checked in" },
  { value: "not-checked-in", label: "not checked in" },
  { value: "refunded", label: "refunded" },
  { value: "void", label: "cancelled" },
] as const;

const TICKET_SORT_OPTIONS = [
  { value: "newest", label: "newest issued" },
  { value: "oldest", label: "oldest issued" },
  { value: "name", label: "name a–z" },
  { value: "status", label: "status" },
] as const;

function isTicketListFilter(value: string): value is TicketListFilter {
  return TICKET_FILTER_OPTIONS.some((option) => option.value === value);
}

function isTicketListSort(value: string): value is TicketListSort {
  return TICKET_SORT_OPTIONS.some((option) => option.value === value);
}

function ticketListStatus(ticket: AdminTicket) {
  if (ticket.status === "refunded") return "refunded";
  if (ticket.status === "void") return "cancelled";
  return ticket.redeemedAt ? "checked in" : "not checked in";
}

function ticketMatchesFilter(ticket: AdminTicket, filter: TicketListFilter) {
  switch (filter) {
    case "all":
      return true;
    case "valid":
      return ticket.status === "valid";
    case "checked-in":
      return ticket.status === "valid" && Boolean(ticket.redeemedAt);
    case "not-checked-in":
      return ticket.status === "valid" && !ticket.redeemedAt;
    case "refunded":
      return ticket.status === "refunded";
    case "void":
      return ticket.status === "void";
  }
}

function formatTicketActivityAt(label: "issued" | "refunded", value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `${label} date unavailable`;
  return `${label} ${date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  })}`;
}

export type EventTicketSummary = {
  total: number;
  valid: number;
  redeemed: number;
  refunded: number;
  void: number;
  grossMinor: number;
  netMinor: number;
  currency?: string;
  reserved: number;
  checkouts: Array<{
    id: string;
    ticketTypeId: string;
    ticketTypeName: string;
    quantity: number;
    holderName: string;
    email: string;
    status: "creating" | "pending" | "payment_pending" | "fulfilling" | "payment_mismatch";
    createdAt: string;
    expiresAt: string;
  }>;
  byType: Record<
    string,
    {
      name: string;
      issued: number;
      redeemed: number;
      valid: number;
      reserved: number;
      remaining: number;
    }
  >;
  tickets: AdminTicket[];
};

export function TicketSalesBreakdown({
  summary,
}: {
  summary: Pick<EventTicketSummary, "byType" | "currency" | "netMinor">;
}) {
  const ticketTypes = Object.entries(summary.byType);

  return (
    <details>
      <summary className="min-h-11 cursor-pointer list-none font-mono marker:content-none">
        <span className="block text-micro theme-muted">net ticket sales</span>
        <span className="text-lg text-foreground">
          {summary.currency ? formatMoney(summary.netMinor, summary.currency) : "—"}
        </span>
        {ticketTypes.length > 0 ? (
          <span className="block text-micro theme-faint underline decoration-dotted underline-offset-4">
            ticket split ↓
          </span>
        ) : null}
      </summary>
      {ticketTypes.length > 0 ? (
        <ul className="mt-2 space-y-1 border-l theme-border pl-3 font-mono text-micro">
          {ticketTypes.map(([id, type]) => (
            <li key={id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate theme-muted">{type.name}</span>
              <span className="shrink-0 text-foreground">
                {type.valid}
                {type.reserved > 0 ? ` + ${type.reserved} held` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

type AdminTicketInvitation = {
  id: string;
  ticketId: string;
  holderName: string;
  recipientEmail: string;
  ticketTypeId: string;
  ticketTypeName: string;
  status: "pending" | "claimed" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  claimedAt?: string;
  cancelledAt?: string;
};

export function parseEventTicketSummary(value: unknown): EventTicketSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numeric = [
    "total",
    "valid",
    "redeemed",
    "refunded",
    "void",
    "grossMinor",
    "netMinor",
    "reserved",
  ];
  if (!numeric.every((key) => typeof record[key] === "number")) return null;
  if (!record.byType || typeof record.byType !== "object" || Array.isArray(record.byType)) {
    return null;
  }
  if (!Array.isArray(record.tickets) || !Array.isArray(record.checkouts)) return null;
  return record as EventTicketSummary;
}

type StepUpHelpers = {
  ensureStepUpToken: () => Promise<
    { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
  >;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
};

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

/** Issue one complimentary ticket and invite its named holder to claim it. */
function AddGuestForm({
  event,
  availability,
  eventUsed,
  authFetch,
  onError,
  onStatus,
  onIssued,
  confirmAction,
}: {
  event: EventRecord;
  availability: EventTicketSummary["byType"];
  eventUsed: number;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onIssued: () => Promise<void>;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
}) {
  const typeId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState(event.ticketTypes[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const typeRemaining = availability[ticketTypeId]?.remaining ?? 0;
  const eventCapacity =
    event.capacity ?? event.ticketTypes.reduce((total, type) => total + type.quantity, 0);
  const eventOverBy = Math.max(0, eventUsed + 1 - eventCapacity);
  const selectedType = event.ticketTypes.find((type) => type.id === ticketTypeId);
  const selectedTypeAvailability = availability[ticketTypeId];
  const typeOverBy = selectedType
    ? Math.max(
        0,
        (selectedTypeAvailability?.valid ?? 0) +
          (selectedTypeAvailability?.reserved ?? 0) +
          1 -
          selectedType.quantity,
      )
    : 0;
  const needsCapacityOverride = eventOverBy > 0 || typeOverBy > 0 || typeRemaining < 1;

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      onError("Enter the ticket holder's name and email address");
      return;
    }
    if (needsCapacityOverride) {
      const confirmed = await confirmAction({
        title: "Send beyond capacity?",
        description:
          eventOverBy > 0
            ? `This ticket will put ${event.title} ${eventOverBy} ${eventOverBy === 1 ? "person" : "people"} over its maximum of ${eventCapacity}.`
            : `This ticket will put ${selectedType?.name ?? "this ticket type"} ${typeOverBy} ${typeOverBy === 1 ? "ticket" : "tickets"} over its allocation of ${selectedType?.quantity ?? 0}. The event itself still has room.`,
        confirmLabel: "send anyway",
        intent: "danger",
      });
      if (!confirmed) return;
    }
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite",
          holderName: name.trim(),
          email: email.trim(),
          ticketTypeId,
          overrideCapacity: needsCapacityOverride,
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to add guest"));
      const data = (await response.json().catch(() => null)) as { emailQueued?: boolean } | null;
      onStatus(
        data?.emailQueued
          ? `Invitation sent to ${email.trim()}`
          : `Ticket reserved for ${name.trim()} · email delivery needs attention`,
      );
      setName("");
      setEmail("");
      await onIssued();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to add guest");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        void submit();
      }}
      className="mt-3 grid gap-3 border-y theme-border py-4 sm:grid-cols-2"
    >
      <Field
        label="recipient email"
        value={email}
        onChange={setEmail}
        type="email"
        hint="new or existing account — the invite handles both"
      />
      <Field label="name on ticket" value={name} onChange={setName} />
      <div>
        <label htmlFor={typeId} className="font-mono text-micro theme-muted tracking-wide">
          ticket type
        </label>
        <AppSelect
          id={typeId}
          value={ticketTypeId}
          onValueChange={setTicketTypeId}
          options={event.ticketTypes.map((type) => ({
            value: type.id,
            label: `${type.name}${(availability[type.id]?.remaining ?? 0) === 0 ? " (sold out)" : ""}`,
          }))}
          variant="field"
          className="mt-1 rounded text-sm"
        />
      </div>
      <p className="self-end pb-1 font-mono text-micro leading-relaxed theme-faint">
        The ticket reserves one place now. It appears in their account after they accept the emailed
        link.
      </p>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={busy || !ticketTypeId}
          className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
        >
          {busy ? "sending invitation…" : "send ticket invitation"}
        </button>
      </div>
    </form>
  );
}

type DropStatus = {
  token: string;
  transferId: string;
  expiresAt: string;
  disabledAt?: string;
  live: boolean;
  fileCount: number;
};

type DropSchedule = {
  opensAt: string;
  durationSeconds: number;
  openedAt?: string;
  cancelledAt?: string;
};

/** Guest media uploads: one shared album per event behind a bearer link. */
function GuestUploadsSection({
  event,
  authFetch,
  onError,
  onStatus,
  confirmAction,
}: {
  event: EventRecord;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
}) {
  const expiryId = useId();
  const [drop, setDrop] = useState<DropStatus | null>(null);
  const [schedule, setSchedule] = useState<DropSchedule | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expiry, setExpiry] = useState("7d");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [dropUrl, setDropUrl] = useState<string | null>(null);
  const { dataUrl: qrDataUrl } = useQrCode(showQr ? dropUrl : null, 320);

  const load = useCallback(async () => {
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/drop`);
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Failed to load guest uploads");
      const status =
        data && typeof data === "object" && "drop" in data && data.drop
          ? (data.drop as DropStatus)
          : null;
      setDrop(status);
      setSchedule(
        data && typeof data === "object" && "schedule" in data && data.schedule
          ? (data.schedule as DropSchedule)
          : null,
      );
      setDropUrl(status ? `${window.location.origin}/drop/${status.token}` : null);
      setLoaded(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load guest uploads");
    }
  }, [authFetch, event.slug, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const enable = async (opensAt?: string) => {
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/drop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiry, opensAt }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to turn uploads on"));
      }
      onStatus(
        opensAt
          ? "Guest uploads will open at the event start"
          : "Guest uploads are on — share the link or QR",
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to turn uploads on");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const confirmed = await confirmAction({
      title: "Turn guest uploads off?",
      description:
        "The link and QR stop working immediately. What guests already sent stays in the album until it expires.",
      confirmLabel: "turn off",
      intent: "danger",
    });
    if (!confirmed) return;

    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/drop`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to turn uploads off"));
      }
      onStatus("Guest uploads turned off");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to turn uploads off");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!dropUrl) return;
    try {
      await navigator.clipboard.writeText(dropUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Couldn't copy — long-press the link text instead");
    }
  };

  if (!loaded) return null;

  return (
    <div className="mt-5 border-t theme-border pt-4">
      <p className="font-mono text-micro theme-muted tracking-wide">guest uploads</p>
      <p className="mt-1 font-mono text-micro theme-faint">
        A shared album guests upload photos and videos into — share the link or put the QR on a
        wall. Previews, video processing, and expiry cleanup are automatic.
      </p>

      {drop?.live ? (
        <div className="mt-3 rounded-lg border theme-border p-3">
          <AdminStatus tone="positive" className="font-mono text-sm">
            on · {drop.fileCount} file{drop.fileCount === 1 ? "" : "s"} so far
          </AdminStatus>
          <p className="font-mono text-micro theme-muted">
            closes{" "}
            {new Date(drop.expiresAt).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="min-h-10 rounded border theme-border-strong px-3 font-mono text-micro text-foreground"
            >
              {copied ? "copied ✓" : "copy upload link"}
            </button>
            <button
              type="button"
              onClick={() => setShowQr((current) => !current)}
              aria-expanded={showQr}
              className="min-h-10 rounded border theme-border-strong px-3 font-mono text-micro text-foreground"
            >
              qr
            </button>
            <a
              href={`/t/${drop.transferId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="min-h-10 rounded border theme-border-strong px-3 py-2 font-mono text-micro text-foreground"
            >
              open album ↗
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => void disable()}
              className="min-h-10 px-2 font-mono text-micro theme-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              turn off
            </button>
          </div>
          {showQr && qrDataUrl && (
            <div className="mt-3 text-center">
              <AppImage
                src={qrDataUrl}
                alt="Guest upload QR"
                width={320}
                height={320}
                className="mx-auto h-40 w-40 rounded bg-white p-1"
              />
              <p className="mt-2 font-mono text-micro theme-muted">
                guests point their camera here to add photos
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={expiryId} className="font-mono text-micro theme-muted tracking-wide">
              uploads stay open for
            </label>
            <AppSelect
              id={expiryId}
              value={expiry}
              onValueChange={setExpiry}
              options={[
                { value: "1d", label: "1 day" },
                { value: "7d", label: "7 days" },
                { value: "14d", label: "14 days" },
                { value: "30d", label: "30 days" },
              ]}
              variant="field"
              className="mt-1 rounded text-sm"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void enable()}
            className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
          >
            {drop && !drop.live ? "turn uploads back on" : "turn uploads on"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void enable(event.startsAt)}
            className="min-h-10 rounded border theme-border-strong px-4 font-mono text-xs disabled:opacity-50"
          >
            open at event start
          </button>
          {schedule && !schedule.openedAt && !schedule.cancelledAt ? (
            <p className="w-full font-mono text-micro theme-muted" role="status">
              scheduled for {new Date(schedule.opensAt).toLocaleString("en-GB")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Scanners' "can we add this person?" — approve comps them straight on. */
function GuestRequestsAdmin({
  event,
  authFetch,
  onError,
  onStatus,
  onDecided,
  confirmAction,
}: {
  event: EventRecord;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  onDecided: () => Promise<void>;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
}) {
  const [requests, setRequests] = useState<GuestRequestRecord[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/guest-requests`);
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Failed to load guest requests");
      setRequests(
        data && typeof data === "object" && "requests" in data && Array.isArray(data.requests)
          ? (data.requests as GuestRequestRecord[])
          : [],
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load guest requests");
    }
  }, [authFetch, event.slug, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (request: GuestRequestRecord, approve: boolean) => {
    if (approve) {
      const confirmed = await confirmAction({
        title: `Add ${request.name} to the list?`,
        description: `Asked from the door by ${request.requestedBy}. Approving issues them a free ticket immediately.`,
        confirmLabel: "add them",
        intent: "default",
      });
      if (!confirmed) return;
    }
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/guest-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: request.id, action: approve ? "approve" : "decline" }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to decide"));
      onStatus(
        approve ? `${request.name} approved and added to the list` : `${request.name} declined`,
      );
      await load();
      if (approve) await onDecided();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to decide");
    } finally {
      setBusy(false);
    }
  };

  const pending = (requests ?? []).filter((request) => request.status === "pending");
  if (requests === null || pending.length === 0) return null;

  return (
    <div className={`mt-4 border-l-2 pl-3 ${adminToneBorderClass("attention")}`}>
      <p className="font-mono text-micro text-foreground">
        {pending.length} guest request{pending.length === 1 ? "" : "s"} from the door
      </p>
      <ul className="mt-2 divide-y theme-border">
        {pending.map((request) => (
          <li key={request.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm text-foreground">{request.name}</p>
              <p className="font-mono text-micro theme-muted">
                asked by {request.requestedBy} ·{" "}
                {new Date(request.createdAt).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide(request, true)}
                className="min-h-9 rounded bg-foreground px-3 font-mono text-micro text-background disabled:opacity-50"
              >
                approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void decide(request, false)}
                className="min-h-9 rounded border theme-border-strong px-3 font-mono text-micro text-foreground disabled:opacity-50"
              >
                decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compose, preview, and send a branded update to attendees. */
function MessageComposer({
  event,
  summary,
  authFetch,
  onError,
  onStatus,
  confirmAction,
}: {
  event: EventRecord;
  summary: EventTicketSummary;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [personQuery, setPersonQuery] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const campaignId = useRef(crypto.randomUUID().replaceAll("-", ""));

  const emailable = useMemo(
    () => summary.tickets.filter((ticket) => ticket.status === "valid" && ticket.email),
    [summary.tickets],
  );
  const personMatches = useMemo(() => {
    const term = personQuery.trim().toLowerCase();
    return emailable
      .filter(
        (ticket) =>
          !term ||
          ticket.holderName.toLowerCase().includes(term) ||
          ticket.email?.toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [emailable, personQuery]);

  const post = async (preview: boolean) => {
    const payload = {
      subject,
      body,
      preview,
      requestId: campaignId.current,
      ...(mode === "selected" ? { recipients: [...selected] } : {}),
    };
    const response = await authFetch(`/api/admin/events/${event.slug}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "Email failed";
      throw new Error(message);
    }
    return data as Record<string, unknown>;
  };

  const preview = async () => {
    setBusy(true);
    onError("");
    try {
      const data = await post(true);
      const rendered = data.rendered as { html: string } | undefined;
      const names = Array.isArray(data.recipients) ? (data.recipients as string[]) : [];
      const count = typeof data.recipientCount === "number" ? data.recipientCount : names.length;
      setPreviewHtml(rendered?.html ?? null);
      setPreviewInfo(
        `${count} recipient${count === 1 ? "" : "s"}${
          count > 0 ? `: ${names.slice(0, 6).join(", ")}${count > 6 ? "…" : ""}` : ""
        }${data.emailConfigured === false ? " · email is NOT configured — sending will fail" : ""}`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const confirmed = await confirmAction({
      title: "Send this email?",
      description: previewInfo ?? "It goes to the selected attendees from the tickets address.",
      confirmLabel: "send",
      intent: "default",
    });
    if (!confirmed) return;

    setBusy(true);
    onError("");
    try {
      const data = await post(false);
      const queued = typeof data.queued === "number" ? data.queued : 0;
      onStatus(`Queued for ${queued} ${queued === 1 ? "person" : "people"}`);
      campaignId.current = crypto.randomUUID().replaceAll("-", "");
      setSubject("");
      setBody("");
      setPreviewHtml(null);
      setPreviewInfo(null);
      setSelected(new Set());
      setOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Sending failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
      >
        {open ? "− close email" : "✉ email attendees"}
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border theme-border p-3">
          <Field label="subject" value={subject} onChange={setSubject} />
          <label className="block">
            <span className="font-mono text-micro theme-muted tracking-wide">message</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              placeholder="Doors open at 8. Bring ID. The door code is in your ticket."
              className="mt-1 w-full rounded border theme-border bg-transparent px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
            <span className="mt-1 block font-mono text-micro theme-faint">
              Plain text; blank lines start new paragraphs. Sent in the same style as ticket emails.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-micro theme-muted">to:</span>
            <button
              type="button"
              onClick={() => setMode("all")}
              aria-pressed={mode === "all"}
              className={`min-h-9 rounded border px-3 font-mono text-micro ${mode === "all" ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground"}`}
            >
              everyone with an email ({emailable.length})
            </button>
            <button
              type="button"
              onClick={() => setMode("selected")}
              aria-pressed={mode === "selected"}
              className={`min-h-9 rounded border px-3 font-mono text-micro ${mode === "selected" ? "border-transparent bg-foreground text-background" : "theme-border-strong text-foreground"}`}
            >
              pick people{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          </div>

          {mode === "selected" && (
            <div>
              <input
                type="search"
                value={personQuery}
                onChange={(event) => setPersonQuery(event.target.value)}
                placeholder="find someone…"
                className="min-h-10 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
              />
              <ul className="mt-1 divide-y theme-border">
                {personMatches.map((ticket) => (
                  <li key={ticket.id}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={selected.has(ticket.id)}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(ticket.id);
                            else next.delete(ticket.id);
                            return next;
                          });
                        }}
                      />
                      <span className="truncate font-mono text-xs text-foreground">
                        {ticket.holderName}
                      </span>
                      <span className="truncate font-mono text-micro theme-muted">
                        {ticket.email}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={() => void preview()}
              className="min-h-10 rounded border theme-border-strong px-4 font-mono text-xs text-foreground disabled:opacity-50"
            >
              preview
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !subject.trim() ||
                !body.trim() ||
                previewHtml === null ||
                (mode === "selected" && selected.size === 0)
              }
              onClick={() => void send()}
              className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
            >
              send
            </button>
            {previewHtml === null && (
              <span className="font-mono text-micro theme-faint">preview before sending</span>
            )}
          </div>

          {previewInfo && <p className="font-mono text-micro theme-muted">{previewInfo}</p>}
          {previewHtml && (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={previewHtml}
              className="h-80 w-full rounded border theme-border bg-white"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * QR of a scanner link, for handing access to someone standing next to you:
 * they point their camera at your screen instead of waiting on a message.
 */
function ScannerLinkQr({ token, label }: { token: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(`${window.location.origin}${scannerPath(token)}`);
  }, [token]);
  const { dataUrl, failed } = useQrCode(url, 320);

  return (
    <div className="mt-2 rounded-lg border theme-border p-3 text-center">
      {dataUrl ? (
        <>
          <AppImage
            src={dataUrl}
            alt={`Scanner access QR for ${label}`}
            width={320}
            height={320}
            className="mx-auto h-40 w-40 rounded bg-white p-1"
          />
          <p className="mt-2 font-mono text-micro theme-muted">
            {label} points their phone camera here — it opens their scanner.
          </p>
        </>
      ) : (
        <AdminStatus tone={failed ? "danger" : "attention"} className="font-mono text-micro">
          {failed ? "QR failed to render — use copy link instead" : "rendering"}
        </AdminStatus>
      )}
    </div>
  );
}

/** Checkpoints and scanner links: who can scan, and what each scan means. */
function ScanningSection({
  event,
  authFetch,
  onError,
  onStatus,
  confirmAction,
  stepUp,
}: {
  event: EventRecord;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
  stepUp: StepUpHelpers;
}) {
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [usage, setUsage] = useState<Record<string, { unitsUsed: number; ticketsServed: number }>>(
    {},
  );
  const [links, setLinks] = useState<ScannerLinkRecord[]>([]);
  const [devices, setDevices] = useState<Record<string, { count: number; lastSeen?: string }>>({});
  const [staffAccess, setStaffAccess] = useState<EventStaffAccessData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCheckpointName, setNewCheckpointName] = useState("");
  const [newCheckpointAllowance, setNewCheckpointAllowance] = useState("1");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [allowancesOpenFor, setAllowancesOpenFor] = useState<string | null>(null);
  const [abilitiesOpenFor, setAbilitiesOpenFor] = useState<string | null>(null);

  const saveAbility = async (link: ScannerLinkRecord, permission: string, value: boolean) => {
    onError("");
    const token = await stepUp.ensureStepUpToken();
    if (!token.ok) {
      if (!token.cancelled) onError(token.error ?? "Step-up failed");
      return;
    }
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/scanner-links`, {
        method: "PATCH",
        headers: stepUp.withStepUpHeaders(token.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          token: link.token,
          // Send every current value so the stored override set is explicit.
          permissions: { ...link.permissions, [permission]: value },
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save abilities"));
      }
      const data: unknown = await response.json().catch(() => null);
      const updated =
        data && typeof data === "object" && "link" in data
          ? (data.link as ScannerLinkRecord)
          : null;
      if (updated) {
        setLinks((current) =>
          current.map((entry) => (entry.token === updated.token ? updated : entry)),
        );
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save abilities");
    }
  };

  const load = useCallback(async () => {
    try {
      const [checkpointsRes, linksRes, staffRes] = await Promise.all([
        authFetch(`/api/admin/events/${event.slug}/checkpoints`),
        authFetch(`/api/admin/events/${event.slug}/scanner-links`),
        authFetch(`/api/admin/events/${event.slug}/staff-access`),
      ]);
      const checkpointsData: unknown = await checkpointsRes.json().catch(() => null);
      const linksData: unknown = await linksRes.json().catch(() => null);
      const staffData: unknown = await staffRes.json().catch(() => null);
      if (!checkpointsRes.ok || !linksRes.ok || !staffRes.ok) {
        throw new Error("Failed to load entry, checkpoint, and staff access setup");
      }

      const nextCheckpoints =
        checkpointsData &&
        typeof checkpointsData === "object" &&
        "checkpoints" in checkpointsData &&
        Array.isArray(checkpointsData.checkpoints)
          ? (checkpointsData.checkpoints as CheckpointRecord[])
          : [];
      setCheckpoints(nextCheckpoints);

      const summaries =
        checkpointsData &&
        typeof checkpointsData === "object" &&
        "summaries" in checkpointsData &&
        Array.isArray(checkpointsData.summaries)
          ? (checkpointsData.summaries as {
              checkpointId: string;
              unitsUsed: number;
              ticketsServed: number;
            }[])
          : [];
      const nextUsage: Record<string, { unitsUsed: number; ticketsServed: number }> = {};
      for (const entry of summaries) {
        nextUsage[entry.checkpointId] = {
          unitsUsed: entry.unitsUsed,
          ticketsServed: entry.ticketsServed,
        };
      }
      setUsage(nextUsage);

      setLinks(
        linksData &&
          typeof linksData === "object" &&
          "links" in linksData &&
          Array.isArray(linksData.links)
          ? (linksData.links as ScannerLinkRecord[])
          : [],
      );
      setDevices(
        linksData &&
          typeof linksData === "object" &&
          "devices" in linksData &&
          linksData.devices &&
          typeof linksData.devices === "object"
          ? (linksData.devices as Record<string, { count: number; lastSeen?: string }>)
          : {},
      );
      if (!staffData || typeof staffData !== "object") {
        throw new Error("Staff access data was unavailable");
      }
      const staffRecord = staffData as Record<string, unknown>;
      setStaffAccess({
        staff: Array.isArray(staffRecord.assignments)
          ? (staffRecord.assignments as AdminStaffAssignment[])
          : [],
        staffRoles: Array.isArray(staffRecord.roles) ? (staffRecord.roles as AdminStaffRole[]) : [],
      });
      setLoaded(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load staff access setup");
    }
  }, [authFetch, event.slug, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const performStaffAction: StaffAccessAction = async (body) => {
    const token = await stepUp.ensureStepUpToken();
    if (!token.ok) {
      if (!token.cancelled) onError(token.error ?? "Step-up failed");
      return null;
    }
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/staff-access`, {
        method: "POST",
        headers: stepUp.withStepUpHeaders(token.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string })
        | null;
      if (!response.ok) throw new Error(result?.error ?? "Staff access change failed");
      await load();
      onStatus("Staff access updated");
      return result ?? {};
    } catch (error) {
      onError(error instanceof Error ? error.message : "Staff access change failed");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const addCheckpoint = async () => {
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/checkpoints`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCheckpointName,
          defaultAllowance: Number.parseInt(newCheckpointAllowance, 10) || 1,
          allowances: {},
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to add checkpoint"));
      }
      onStatus(`“${newCheckpointName.trim()}” checkpoint added`);
      setNewCheckpointName("");
      setNewCheckpointAllowance("1");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to add checkpoint");
    } finally {
      setBusy(false);
    }
  };

  const saveAllowance = async (checkpoint: CheckpointRecord, ticketTypeId: string, raw: string) => {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) return;
    const nextAllowances = { ...checkpoint.allowances, [ticketTypeId]: value };
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/checkpoints`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checkpoint, allowances: nextAllowances }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save allowance"));
      }
      setCheckpoints((current) =>
        current.map((entry) =>
          entry.id === checkpoint.id ? { ...entry, allowances: nextAllowances } : entry,
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save allowance");
    }
  };

  const saveCheckpointMode = async (checkpoint: CheckpointRecord, multiScan: boolean) => {
    if (checkpoint.multiScan === multiScan) return;
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/checkpoints`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checkpoint, multiScan }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to save scan behaviour"));
      }
      setCheckpoints((current) =>
        current.map((entry) => (entry.id === checkpoint.id ? { ...entry, multiScan } : entry)),
      );
      onStatus(
        `${checkpoint.name} now records ${multiScan ? "a chosen quantity" : "one item"} per scan`,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save scan behaviour");
    }
  };

  const removeCheckpoint = async (checkpoint: CheckpointRecord) => {
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/checkpoints`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: checkpoint.id }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to remove checkpoint"));
      }
      onStatus(`“${checkpoint.name}” removed`);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to remove checkpoint");
    } finally {
      setBusy(false);
    }
  };

  const revokeLink = async (link: ScannerLinkRecord) => {
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/scanner-links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: link.token }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to turn the link off"));
      }
      onStatus(`${link.label}'s link turned off`);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to turn the link off");
    } finally {
      setBusy(false);
    }
  };

  const revokeAllLinks = async () => {
    const confirmed = await confirmAction({
      title: "Turn off every scanner link?",
      description:
        "Everyone scanning for this event loses access on their next scan. You can make fresh links any time.",
      confirmLabel: "turn all off",
      intent: "danger",
    });
    if (!confirmed) return;

    setBusy(true);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/scanner-links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to turn the links off"));
      }
      onStatus("All scanner links turned off");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to turn the links off");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (link: ScannerLinkRecord) => {
    const url = `${window.location.origin}${scannerPath(link.token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(link.token);
      setTimeout(
        () => setCopiedToken((current) => (current === link.token ? null : current)),
        2000,
      );
    } catch {
      onError("Couldn't copy — long-press the link text instead");
    }
  };

  const stationName = (checkpointId: string | null) =>
    checkpointId === null
      ? "door"
      : (checkpoints.find((entry) => entry.id === checkpointId)?.name ?? checkpointId);

  const toggleQr = (token: string) => {
    setQrToken((current) => (current === token ? null : token));
  };

  if (!loaded) {
    return <p className="mt-4 font-mono text-xs theme-muted">loading staff access…</p>;
  }

  const liveLinks = links.filter((link) => !link.revokedAt);
  return (
    <div className="mt-5 space-y-5 border-t theme-border pt-4">
      {staffAccess && (
        <EventStaffAccessPanel
          eventSlug={event.slug}
          checkpoints={checkpoints.map(({ id, name }) => ({ id, name }))}
          roles={staffAccess.staffRoles}
          staff={staffAccess.staff}
          onAction={performStaffAction}
          defaultPreset="door-scanner"
        />
      )}

      {liveLinks.length > 0 && (
        <details className="border-y theme-border py-4">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-mono text-xs text-foreground">
            <span>older shared scanner links</span>
            <AdminStatus tone="attention">{liveLinks.length} to review</AdminStatus>
          </summary>
          <div className="pt-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h4 className="font-mono text-micro theme-muted tracking-wide">
                  legacy shared access
                </h4>
                <p className="mt-1 font-mono text-micro theme-faint">
                  These reusable links predate identity-based roles. Keep them only for supervised
                  station devices; add new people through a role above.
                </p>
              </div>
              <AdminStatus tone="attention">{liveLinks.length} active</AdminStatus>
            </div>

            {liveLinks.length > 0 && (
              <ul className="mt-3 divide-y theme-border border-y theme-border">
                {liveLinks.map((link) => (
                  <li key={link.token} className="py-2">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-foreground">
                          {link.label}
                          {link.role === "manager" && (
                            <span className="ml-2 rounded border theme-border-strong px-1.5 py-0.5 font-mono text-micro theme-muted">
                              manager
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2 font-mono text-micro theme-muted">
                          <span>{stationName(link.checkpointId)}</span>
                          <span aria-hidden="true">·</span>
                          {(() => {
                            const info = devices[link.token];
                            if (!info || info.count === 0) {
                              return <AdminStatus tone="attention">not opened yet</AdminStatus>;
                            }
                            return (
                              <AdminStatus tone="positive">
                                {info.count} phone{info.count === 1 ? "" : "s"}
                                {info.lastSeen
                                  ? ` · active ${new Date(info.lastSeen).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`
                                  : ""}
                              </AdminStatus>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => void copyLink(link)}
                          className="min-h-11 rounded border theme-border-strong px-3 font-mono text-micro text-foreground"
                        >
                          {copiedToken === link.token ? "copied ✓" : "copy link"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleQr(link.token)}
                          aria-expanded={qrToken === link.token}
                          className="min-h-11 rounded border theme-border-strong px-3 font-mono text-micro text-foreground"
                        >
                          qr
                        </button>
                        {link.checkpointId === null && (
                          <button
                            type="button"
                            onClick={() =>
                              setAbilitiesOpenFor((current) =>
                                current === link.token ? null : link.token,
                              )
                            }
                            aria-expanded={abilitiesOpenFor === link.token}
                            className="min-h-11 rounded border theme-border-strong px-3 font-mono text-micro text-foreground"
                          >
                            abilities
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revokeLink(link)}
                          className="min-h-11 px-2 font-mono text-micro theme-muted hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          turn off
                        </button>
                      </div>
                    </div>
                    {qrToken === link.token && (
                      <ScannerLinkQr token={link.token} label={link.label} />
                    )}
                    {abilitiesOpenFor === link.token && (
                      <div className="mt-2 rounded-lg border theme-border p-3">
                        <p className="font-mono text-micro theme-muted">
                          what {link.label} can do beyond scanning · defaults come from their level
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                          {SCANNER_PERMISSIONS.map((permission) => (
                            <label
                              key={permission}
                              className="flex min-h-9 cursor-pointer items-center gap-2"
                            >
                              <input
                                type="checkbox"
                                checked={link.permissions[permission]}
                                onChange={(inputEvent) =>
                                  void saveAbility(link, permission, inputEvent.target.checked)
                                }
                              />
                              <span className="font-mono text-micro text-foreground">
                                {SCANNER_PERMISSION_LABELS[permission]}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {liveLinks.length > 1 && (
              <p className="mt-2 text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void revokeAllLinks()}
                  className="font-mono text-micro theme-muted underline hover:text-foreground transition-colors disabled:opacity-50"
                >
                  turn off all {liveLinks.length} links
                </button>
              </p>
            )}
          </div>
        </details>
      )}

      <div>
        <p className="font-mono text-micro theme-muted tracking-wide">checkpoints</p>
        <p className="mt-1 max-w-2xl font-mono text-micro theme-faint">
          Set what each ticket may collect, then choose whether staff record one item or select a
          quantity after scanning. Door check-in is separate.
        </p>

        {checkpoints.length > 0 && (
          <div className="mt-3 border-y theme-border">
            {checkpoints.map((checkpoint) => {
              const stats = usage[checkpoint.id];
              const overrides = event.ticketTypes
                .filter(
                  (type) =>
                    checkpoint.allowances[type.id] !== undefined &&
                    checkpoint.allowances[type.id] !== checkpoint.defaultAllowance,
                )
                .map((type) => `${type.name} ${checkpoint.allowances[type.id]}`);
              return (
                <details
                  key={checkpoint.id}
                  className="group border-b theme-border last:border-b-0"
                >
                  <summary className="grid min-h-16 cursor-pointer list-none gap-2 px-3 py-3 marker:content-none sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
                    <span className="min-w-0">
                      <span className="block font-mono text-sm text-foreground">
                        {checkpoint.name}
                      </span>
                      <span className="mt-1 block font-mono text-micro theme-muted">
                        {stats
                          ? `${stats.unitsUsed} given out to ${stats.ticketsServed} ticket${stats.ticketsServed === 1 ? "" : "s"}`
                          : "nothing given out yet"}
                      </span>
                    </span>
                    <span className="font-mono text-micro theme-muted">
                      {checkpoint.defaultAllowance} per ticket
                      {overrides.length > 0 ? ` · ${overrides.length} custom` : ""}
                    </span>
                    <span className="flex items-center justify-between gap-3 font-mono text-micro text-foreground sm:min-w-36 sm:justify-end">
                      {checkpoint.multiScan ? "choose quantity" : "one at a time"}
                      <span aria-hidden="true" className="group-open:hidden">
                        ↓
                      </span>
                      <span aria-hidden="true" className="hidden group-open:inline">
                        ↑
                      </span>
                    </span>
                  </summary>

                  <div className="border-t theme-border bg-[var(--stone-50)] px-3 py-4 dark:bg-white/[0.02]">
                    <fieldset>
                      <legend className="font-mono text-xs text-foreground">
                        after staff scan this ticket
                      </legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {[
                          {
                            value: false,
                            title: "record one item",
                            description: "The scan immediately deducts exactly 1.",
                          },
                          {
                            value: true,
                            title: "let staff choose quantity",
                            description:
                              "Staff can select 1 up to the ticket’s remaining allowance.",
                          },
                        ].map((option) => (
                          <label
                            key={String(option.value)}
                            className={`cursor-pointer border p-3 transition-opacity hover:opacity-70 ${
                              checkpoint.multiScan === option.value
                                ? "border-[var(--prose-hashtag)]"
                                : "theme-border"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="radio"
                                name={`checkpoint-mode-${checkpoint.id}`}
                                checked={checkpoint.multiScan === option.value}
                                onChange={() => void saveCheckpointMode(checkpoint, option.value)}
                              />
                              <span className="font-mono text-xs text-foreground">
                                {option.title}
                              </span>
                            </span>
                            <span className="mt-1 block pl-5 font-mono text-micro leading-relaxed theme-muted">
                              {option.description}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="mt-5 border-t theme-border pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs text-foreground">ticket allowances</p>
                          <p className="mt-1 font-mono text-micro theme-muted">
                            {overrides.length > 0
                              ? `${checkpoint.defaultAllowance} normally · ${overrides.join(" · ")}`
                              : `${checkpoint.defaultAllowance} for every ticket type`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAllowancesOpenFor((current) =>
                              current === checkpoint.id ? null : checkpoint.id,
                            )
                          }
                          aria-expanded={allowancesOpenFor === checkpoint.id}
                          className="min-h-11 border theme-border px-3 font-mono text-micro text-foreground hover:opacity-70"
                        >
                          {allowancesOpenFor === checkpoint.id
                            ? "done adjusting"
                            : "adjust by ticket type"}
                        </button>
                      </div>
                    </div>
                    {allowancesOpenFor === checkpoint.id && (
                      <>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {event.ticketTypes.map((type) => (
                            <label
                              key={type.id}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="font-mono text-micro theme-muted">{type.name}</span>
                              <input
                                type="number"
                                min={0}
                                defaultValue={
                                  checkpoint.allowances[type.id] ?? checkpoint.defaultAllowance
                                }
                                onBlur={(inputEvent) =>
                                  void saveAllowance(checkpoint, type.id, inputEvent.target.value)
                                }
                                className="w-16 min-h-9 rounded border theme-border bg-transparent px-2 text-right font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
                              />
                            </label>
                          ))}
                        </div>
                        <p className="mt-2 font-mono text-micro theme-faint">
                          0 means that ticket type is not entitled to this item. Changes save when
                          you leave a field.
                        </p>
                      </>
                    )}
                    <p className="mt-5 border-t theme-border pt-3 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeCheckpoint(checkpoint)}
                        className="min-h-11 font-mono text-micro theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
                      >
                        remove checkpoint
                      </button>
                    </p>
                  </div>
                </details>
              );
            })}
          </div>
        )}

        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            if (newCheckpointName.trim()) void addCheckpoint();
          }}
          className="mt-3 grid gap-x-2 gap-y-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-start"
        >
          <Field
            label="new checkpoint"
            value={newCheckpointName}
            onChange={setNewCheckpointName}
            hint="e.g. Dinner, Welcome drink, Merch"
            className="min-w-0"
          />
          <Field
            label="standard allowance"
            value={newCheckpointAllowance}
            onChange={setNewCheckpointAllowance}
            type="number"
            className="min-w-0"
          />
          <div className="sm:pt-7">
            <button
              type="submit"
              disabled={busy || !newCheckpointName.trim()}
              className="min-h-10 w-full rounded border theme-border-strong px-4 font-mono text-xs text-foreground disabled:opacity-50 sm:w-auto"
            >
              add checkpoint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EventOperations({
  event,
  summary,
  authFetch,
  onError,
  onStatus,
  reload,
  confirmAction,
  stepUp,
  permissions,
}: {
  event: EventRecord;
  summary: EventTicketSummary;
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  reload: () => Promise<void>;
  confirmAction: (options: {
    title: string;
    description: string;
    confirmLabel: string;
    intent: "danger" | "default";
  }) => Promise<boolean>;
  stepUp: StepUpHelpers;
  permissions: GlobalAdminPermissionSet;
}) {
  const [activeTool, setActiveTool] = useState<EventOperationsTool>("overview");
  const toolsNavRef = useRef<HTMLElement>(null);
  const toolScrollPositions = useRef(new Map<EventOperationsTool, number>());
  const pendingToolScrollTop = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [ticketFilter, setTicketFilter] = useState<TicketListFilter>("all");
  const [ticketSort, setTicketSort] = useState<TicketListSort>("newest");
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [editingTicket, setEditingTicket] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [exchangingTicket, setExchangingTicket] = useState<{
    id: string;
    holderName: string;
    fromTicketTypeId: string;
    targetTicketTypeId: string;
  } | null>(null);
  const [exchangePaymentLink, setExchangePaymentLink] = useState<{
    ticketId: string;
    url: string;
  } | null>(null);
  const [invitations, setInvitations] = useState<AdminTicketInvitation[]>([]);
  const [invitationsLoaded, setInvitationsLoaded] = useState(false);
  const [showInvitations, setShowInvitations] = useState(false);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const targetTop = pendingToolScrollTop.current;
    if (targetTop === null) return;
    pendingToolScrollTop.current = null;
    window.scrollTo(0, targetTop);
    let settleFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      settleFrame = window.requestAnimationFrame(() => window.scrollTo(0, targetTop));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [activeTool]);

  const handleToolChange = (tool: EventOperationsTool) => {
    if (tool === activeTool) return;
    toolScrollPositions.current.set(activeTool, window.scrollY);
    pendingToolScrollTop.current = toolScrollPositions.current.get(tool) ?? window.scrollY;
    setActiveTool(tool);
  };

  const loadInvitations = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`);
      const data = (await response.json().catch(() => null)) as {
        invitations?: AdminTicketInvitation[];
      } | null;
      if (!response.ok || !Array.isArray(data?.invitations)) {
        throw new Error("Failed to load ticket invitations");
      }
      if (isCurrent()) {
        setInvitations(data.invitations);
        setInvitationsLoaded(true);
      }
    },
    [authFetch, event.slug],
  );

  useEffect(() => {
    if (activeTool !== "tickets") return;
    void loadInvitations().catch((error: unknown) => {
      onError(error instanceof Error ? error.message : "Failed to load ticket invitations");
    });
  }, [activeTool, loadInvitations, onError]);

  const pendingInvitationCount = invitations.filter(
    (invitation) => invitation.status === "pending",
  ).length;
  const hasPendingInvitation = pendingInvitationCount > 0;
  const invitationByTicketId = useMemo(
    () => new Map(invitations.map((invitation) => [invitation.ticketId, invitation])),
    [invitations],
  );
  useAdminAutoRefresh({
    enabled: activeTool === "tickets" && hasPendingInvitation,
    cadence: "monitoring",
    identity: `event-ticket-invitations:${event.slug}`,
    refreshOnEnable: false,
    refresh: loadInvitations,
  });

  const runInvitationAction = async (
    invitation: AdminTicketInvitation,
    action: "resend-invitation" | "cancel-invitation",
  ) => {
    if (action === "cancel-invitation") {
      const confirmed = await confirmAction({
        title: `Cancel ${invitation.holderName}'s invitation?`,
        description:
          "The acceptance link and reserved ticket will stop working, and the place returns to capacity.",
        confirmLabel: "cancel invitation",
        intent: "danger",
      });
      if (!confirmed) return;
    }
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    if (action === "cancel-invitation") {
      const token = await stepUp.ensureStepUpToken();
      if (!token.ok) {
        if (!token.cancelled) onError(token.error ?? "Step-up failed");
        return;
      }
      headers = stepUp.withStepUpHeaders(token.token, headers);
    }
    setBusyInvitationId(invitation.id);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, invitationId: invitation.id }),
      });
      if (!response.ok) {
        throw new Error(
          await readErrorMessage(
            response,
            action === "cancel-invitation" ? "Cancellation failed" : "Resend failed",
          ),
        );
      }
      const result = (await response.json().catch(() => null)) as {
        emailQueued?: boolean;
      } | null;
      onStatus(
        action === "cancel-invitation"
          ? `${invitation.holderName}'s invitation and ticket cancelled`
          : result?.emailQueued
            ? `Reminder email sent to ${invitation.recipientEmail}`
            : `Invitation renewed · email delivery needs attention`,
      );
      await Promise.all([loadInvitations(), reload()]);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Invitation action failed");
    } finally {
      setBusyInvitationId(null);
    }
  };

  const saveHolder = async () => {
    const editing = editingTicket;
    if (!editing) return;
    setBusyTicketId(editing.id);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          ticketId: editing.id,
          holderName: editing.name,
          email: editing.email.trim(),
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to save"));
      onStatus("Ticket holder updated");
      setEditingTicket(null);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setBusyTicketId(null);
    }
  };

  const exchangeTicket = async () => {
    const exchange = exchangingTicket;
    if (!exchange?.targetTicketTypeId) return;
    const from = event.ticketTypes.find((type) => type.id === exchange.fromTicketTypeId);
    const target = event.ticketTypes.find((type) => type.id === exchange.targetTicketTypeId);
    if (!from || !target) return;
    const delta = target.priceMinor - from.priceMinor;
    const confirmed = await confirmAction({
      title: `Change ${exchange.holderName}'s ticket?`,
      description:
        delta < 0
          ? `${from.name} → ${target.name}. ${formatMoney(Math.abs(delta), target.currency)} will return to the original payment method. The QR stays the same.`
          : delta > 0
            ? `${from.name} → ${target.name}. A ${formatMoney(delta, target.currency)} Stripe payment link will be copied for the purchaser. The ticket changes after payment.`
            : `${from.name} → ${target.name}. No money moves and the QR stays the same.`,
      confirmLabel: delta > 0 ? "create payment link" : "change ticket",
      intent: "default",
    });
    if (!confirmed) return;

    const token = await stepUp.ensureStepUpToken();
    if (!token.ok) {
      if (!token.cancelled) onError(token.error ?? "Step-up failed");
      return;
    }
    setBusyTicketId(exchange.id);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`, {
        method: "POST",
        headers: stepUp.withStepUpHeaders(token.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "exchange",
          ticketId: exchange.id,
          targetTicketTypeId: exchange.targetTicketTypeId,
        }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Ticket change failed"));
      const result = (await response.json()) as { state?: string; url?: string; message?: string };
      if (result.state === "checkout" && result.url) {
        setExchangePaymentLink({ ticketId: exchange.id, url: result.url });
        try {
          await navigator.clipboard.writeText(result.url);
          onStatus(`Payment link ready and copied for ${exchange.holderName}`);
        } catch {
          onStatus(`Payment link ready for ${exchange.holderName}`);
        }
      } else {
        onStatus(result.message ?? `${exchange.holderName}'s ticket changed`);
      }
      setExchangingTicket(null);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Ticket change failed");
    } finally {
      setBusyTicketId(null);
    }
  };

  const runTicketAction = async (
    ticket: AdminTicket,
    action: "resend" | "refund" | "void" | "unredeem" | "redeem",
  ) => {
    if (action === "refund") {
      const confirmed = await confirmAction({
        title: `Refund ${ticket.holderName}'s ticket?`,
        description:
          "This ticket's allocated amount goes back to the original card and only this QR stops working. This cannot be undone.",
        confirmLabel: "refund ticket",
        intent: "danger",
      });
      if (!confirmed) return;
    }
    if (action === "void") {
      const confirmed = await confirmAction({
        title: `Cancel ${ticket.holderName}'s ticket?`,
        description: "The QR stops working at the door. No money moves.",
        confirmLabel: "cancel ticket",
        intent: "danger",
      });
      if (!confirmed) return;
    }

    let headers: Record<string, string> = { "Content-Type": "application/json" };
    if (action === "refund" || action === "void") {
      const token = await stepUp.ensureStepUpToken();
      if (!token.ok) {
        if (!token.cancelled) onError(token.error ?? "Step-up failed");
        return;
      }
      headers = stepUp.withStepUpHeaders(token.token, headers);
    }

    setBusyTicketId(ticket.id);
    onError("");
    try {
      const response = await authFetch(`/api/admin/events/${event.slug}/tickets`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, ticketId: ticket.id }),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Action failed"));
      const result = (await response.json()) as {
        state?: string;
        emailQueued?: boolean;
        alreadyRequested?: boolean;
      };
      const refundPending = action === "refund" && result.state === "pending";
      onStatus(
        action === "resend"
          ? result.alreadyRequested
            ? `A resend for ${ticket.holderName}'s order was already requested · no duplicate queued`
            : `One ticket email queued for ${ticket.holderName}'s order`
          : action === "refund"
            ? refundPending
              ? `${ticket.holderName}'s refund is processing`
              : result.emailQueued
                ? `${ticket.holderName}'s ticket refunded · confirmation email queued`
                : `${ticket.holderName}'s ticket refunded · confirmation email needs attention`
            : action === "void"
              ? `${ticket.holderName}'s ticket cancelled`
              : action === "redeem"
                ? `${ticket.holderName} checked in`
                : `${ticket.holderName}'s check-in undone`,
      );
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyTicketId(null);
    }
  };

  const capacity =
    event.capacity ?? event.ticketTypes.reduce((total, type) => total + type.quantity, 0);
  const remaining = Math.max(0, capacity - summary.valid - summary.reserved);
  const overage = Math.max(0, summary.valid + summary.reserved - capacity);
  const term = query.trim().toLowerCase();
  const tickets = useMemo(() => {
    const filtered = summary.tickets.filter(
      (ticket) =>
        ticketMatchesFilter(ticket, ticketFilter) &&
        (!term ||
          ticket.holderName.toLowerCase().includes(term) ||
          ticket.email?.toLowerCase().includes(term) ||
          ticket.id.toLowerCase().includes(term)),
    );
    return filtered.toSorted((left, right) => {
      if (ticketSort === "name") return left.holderName.localeCompare(right.holderName);
      if (ticketSort === "status") {
        const statusOrder = ticketListStatus(left).localeCompare(ticketListStatus(right));
        return statusOrder || left.holderName.localeCompare(right.holderName);
      }
      const issuedOrder = left.issuedAt.localeCompare(right.issuedAt);
      return ticketSort === "oldest" ? issuedOrder : -issuedOrder;
    });
  }, [summary.tickets, term, ticketFilter, ticketSort]);
  const operationTools: Array<{ value: EventOperationsTool; label: string }> = [
    { value: "overview", label: "overview" },
    { value: "tickets", label: "tickets" },
    ...(permissions.manageEvents ? [{ value: "waitlist" as const, label: "waitlist" }] : []),
    ...(permissions.manageEvents ? [{ value: "door" as const, label: "staff" }] : []),
    ...(permissions.manageCommunications
      ? [{ value: "messages" as const, label: "messages" }]
      : []),
    ...(permissions.manageEvents ? [{ value: "uploads" as const, label: "guest uploads" }] : []),
  ];

  return (
    <div className="mt-4 min-h-[75vh] border-t theme-border pt-4 [overflow-anchor:none]">
      <nav
        ref={toolsNavRef}
        aria-label={`${event.title} tools`}
        className="sticky top-14 z-10 -mx-2 mb-5 flex gap-x-1 overflow-x-auto border-b theme-border bg-background px-2"
      >
        {operationTools.map((tool) => (
          <button
            key={tool.value}
            type="button"
            onClick={() => handleToolChange(tool.value)}
            aria-current={activeTool === tool.value ? "page" : undefined}
            className={`relative min-h-11 shrink-0 px-3 font-mono text-micro transition-opacity hover:opacity-70 ${
              activeTool === tool.value ? "font-bold text-foreground" : "theme-subtle"
            }`}
          >
            {tool.label}
            {activeTool === tool.value ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 bottom-0 h-0.5 bg-[var(--prose-hashtag)]"
              />
            ) : null}
          </button>
        ))}
      </nav>

      {activeTool === "overview" && (
        <div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <div>
              <p className="font-mono text-micro theme-muted">live tickets</p>
              <p className="font-mono text-lg text-foreground">
                {summary.valid}/{capacity}
              </p>
              {summary.reserved > 0 && (
                <button
                  type="button"
                  onClick={() => handleToolChange("tickets")}
                  aria-controls="active-checkouts-list"
                  className="min-h-11 font-mono text-micro theme-faint underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  +{summary.reserved} in checkout · show
                </button>
              )}
            </div>
            <div>
              <p className="font-mono text-micro theme-muted">
                {overage > 0 ? "over capacity" : "remaining"}
              </p>
              <p
                className={`font-mono text-lg ${
                  overage > 0 ? adminToneTextClass("danger") : "text-foreground"
                }`}
              >
                {overage > 0 ? `+${overage}` : remaining}
              </p>
            </div>
            <div>
              <p className="font-mono text-micro theme-muted">checked in</p>
              <p className="font-mono text-lg text-foreground">
                {summary.redeemed}/{summary.valid}
              </p>
            </div>
            <TicketSalesBreakdown summary={summary} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-micro theme-muted">
            <span>{summary.total} issued lifetime</span>
            {summary.refunded > 0 && (
              <button
                type="button"
                onClick={() => {
                  setTicketFilter("refunded");
                  setActiveTool("tickets");
                }}
                className="min-h-11 underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                {summary.refunded} refunded · show
              </button>
            )}
            {summary.void > 0 && <span>{summary.void} void</span>}
            {summary.grossMinor !== summary.netMinor && summary.currency && (
              <span>{formatMoney(summary.grossMinor, summary.currency)} gross</span>
            )}
          </div>

          {permissions.manageEvents ? (
            <GuestRequestsAdmin
              event={event}
              authFetch={authFetch}
              onError={onError}
              onStatus={onStatus}
              onDecided={reload}
              confirmAction={confirmAction}
            />
          ) : null}
        </div>
      )}

      {activeTool === "tickets" && (
        <div>
          {summary.checkouts.length > 0 && (
            <section className="mt-4 border-t theme-border pt-4" aria-labelledby="checkouts-title">
              <h4 id="checkouts-title" className="font-mono text-xs text-foreground">
                in checkout
              </h4>
              <p className="mt-1 font-mono text-micro theme-faint">
                These places are held while payment is unfinished. They become tickets only after
                payment succeeds.
              </p>
              <ul id="active-checkouts-list" className="mt-2 divide-y theme-divide">
                {summary.checkouts.map((checkout) => (
                  <li key={checkout.id} className="py-3">
                    <p className="truncate font-mono text-sm text-foreground">
                      {checkout.holderName}
                    </p>
                    <p className="truncate font-mono text-micro theme-muted">
                      {checkout.email} · {checkout.quantity} × {checkout.ticketTypeName}
                    </p>
                    <AdminStatus
                      tone={checkout.status === "payment_mismatch" ? "danger" : "attention"}
                      className="mt-1 font-mono text-micro"
                    >
                      {checkout.status.replaceAll("_", " ")} · started{" "}
                      {new Date(checkout.createdAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/London",
                      })}
                    </AdminStatus>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {permissions.manageTickets ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowAddGuest((current) => !current)}
                aria-expanded={showAddGuest}
                className="font-mono text-xs theme-muted hover:text-foreground transition-colors"
              >
                {showAddGuest ? "− close" : "+ send someone a ticket"}
              </button>
              {showAddGuest && (
                <AddGuestForm
                  event={event}
                  availability={summary.byType}
                  eventUsed={summary.valid + summary.reserved}
                  authFetch={authFetch}
                  onError={onError}
                  onStatus={onStatus}
                  onIssued={async () => {
                    await Promise.all([reload(), loadInvitations()]);
                  }}
                  confirmAction={confirmAction}
                />
              )}
            </div>
          ) : null}

          {invitationsLoaded && invitations.length > 0 && (
            <section
              className="mt-5 border-t theme-border pt-4"
              aria-labelledby="ticket-invites-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 id="ticket-invites-title" className="font-mono text-xs text-foreground">
                    ticket invitations
                  </h4>
                  <AdminStatus
                    tone={hasPendingInvitation ? "attention" : "neutral"}
                    className="mt-1 font-mono text-micro"
                  >
                    {pendingInvitationCount} awaiting acceptance · updates automatically
                  </AdminStatus>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInvitations((current) => !current)}
                  aria-expanded={showInvitations}
                  aria-controls="ticket-invitations-list"
                  className="min-h-11 rounded border theme-border px-3 font-mono text-micro text-foreground hover:opacity-70"
                >
                  {showInvitations
                    ? "hide invitations"
                    : hasPendingInvitation
                      ? "review and remind"
                      : "show invitation history"}
                </button>
              </div>
              {showInvitations && (
                <>
                  {hasPendingInvitation && (
                    <p className="mt-3 font-mono text-micro theme-faint">
                      Send a reminder when someone needs another email. Their previous acceptance
                      link is replaced by the fresh one.
                    </p>
                  )}
                  <ul
                    id="ticket-invitations-list"
                    className="mt-2 divide-y theme-divide"
                    aria-live="polite"
                  >
                    {invitations.map((invitation) => {
                      const pending = invitation.status === "pending";
                      const expired = invitation.status === "expired";
                      const busy = busyInvitationId === invitation.id;
                      const statusLabel =
                        invitation.status === "claimed"
                          ? "accepted"
                          : invitation.status === "cancelled"
                            ? "cancelled"
                            : invitation.status;
                      return (
                        <li
                          key={invitation.id}
                          className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">
                              {invitation.holderName}
                            </p>
                            <p className="truncate font-mono text-micro theme-muted">
                              {invitation.recipientEmail} · {invitation.ticketTypeName}
                            </p>
                            <AdminStatus
                              tone={adminToneForStatus(statusLabel)}
                              className="mt-1 font-mono text-micro"
                            >
                              {statusLabel}
                              {pending &&
                                ` · expires ${new Date(invitation.expiresAt).toLocaleDateString(
                                  "en-GB",
                                  {
                                    day: "numeric",
                                    month: "short",
                                    timeZone: "Europe/London",
                                  },
                                )}`}
                              {invitation.status === "claimed" &&
                                invitation.claimedAt &&
                                ` · ${new Date(invitation.claimedAt).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  timeZone: "Europe/London",
                                })}`}
                            </AdminStatus>
                          </div>
                          {permissions.manageTickets && (pending || expired) && (
                            <div className="flex shrink-0 gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runInvitationAction(invitation, "resend-invitation")
                                }
                                className="min-h-11 rounded border theme-border px-3 font-mono text-xs text-foreground hover:opacity-70 disabled:opacity-50"
                              >
                                {expired ? "send new invite" : "send reminder"}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runInvitationAction(invitation, "cancel-invitation")
                                }
                                className="min-h-11 px-2 font-mono text-xs theme-muted underline decoration-dotted underline-offset-4 hover:opacity-70 disabled:opacity-50"
                              >
                                cancel
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          )}

          <label className="mt-5 block">
            <span className="font-mono text-micro theme-muted">
              find attendee, email, or ticket
            </span>
            <input
              type="search"
              value={query}
              onChange={(inputEvent) => setQuery(inputEvent.target.value)}
              placeholder="start typing…"
              className="mt-1 min-h-11 w-full rounded border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <span className="font-mono text-micro theme-muted">show</span>
              <AppSelect
                value={ticketFilter}
                onValueChange={(value) => {
                  if (isTicketListFilter(value)) setTicketFilter(value);
                }}
                options={TICKET_FILTER_OPTIONS}
                ariaLabel="Filter tickets"
              />
            </div>
            <div className="grid gap-1">
              <span className="font-mono text-micro theme-muted">sort</span>
              <AppSelect
                value={ticketSort}
                onValueChange={(value) => {
                  if (isTicketListSort(value)) setTicketSort(value);
                }}
                options={TICKET_SORT_OPTIONS}
                ariaLabel="Sort tickets"
              />
            </div>
            <p
              className="min-h-11 content-center font-mono text-micro theme-faint"
              aria-live="polite"
            >
              {tickets.length} of {summary.total}
            </p>
          </div>

          {tickets.length === 0 ? (
            <p className="py-4 font-mono text-xs theme-faint">
              {summary.total === 0 ? "no tickets issued yet" : "no tickets match these filters"}
            </p>
          ) : (
            <ul className="mt-2 max-h-96 divide-y theme-border overflow-y-auto border-y theme-border">
              {tickets.map((ticket) => {
                const busy = busyTicketId === ticket.id;
                const isLive = ticket.status === "valid";
                const paid = (ticket.amountPaidMinor ?? 0) > 0;
                const ticketInvitation = invitationByTicketId.get(ticket.id);
                const awaitingAcceptance = ticketInvitation?.status === "pending";
                return (
                  <li key={ticket.id} className="py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-foreground">
                          {ticket.holderName}
                        </p>
                        <p className="truncate font-mono text-micro theme-muted">
                          {ticket.email ?? "no email"} · {ticket.ticketTypeName}
                          {ticket.kind === "comp" ? " · comp" : ""}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-micro theme-faint">
                          <span>{ticket.id}</span>
                          <span aria-hidden="true">·</span>
                          <AdminStatus
                            tone={
                              awaitingAcceptance
                                ? "attention"
                                : ticket.status === "valid"
                                  ? "positive"
                                  : "neutral"
                            }
                          >
                            {awaitingAcceptance ? "awaiting acceptance" : ticketListStatus(ticket)}
                          </AdminStatus>
                          <span>· {formatTicketActivityAt("issued", ticket.issuedAt)}</span>
                          {ticket.status === "refunded" && ticket.refundedAt && (
                            <span>· {formatTicketActivityAt("refunded", ticket.refundedAt)}</span>
                          )}
                        </div>
                        {awaitingAcceptance && (
                          <p className="mt-1 font-mono text-micro theme-muted">
                            QR withheld until the recipient accepts · use the invitation controls
                            above
                          </p>
                        )}
                        {ticket.activeExchange && (
                          <div
                            role={ticket.activeExchange.errorMessage ? "alert" : "status"}
                            className={`mt-1 border-l-2 pl-3 font-mono text-micro ${adminToneBorderClass(
                              ticket.activeExchange.errorMessage ? "danger" : "attention",
                            )}`}
                          >
                            {ticket.activeExchange.errorMessage ??
                              `change to ${ticket.activeExchange.toTicketTypeName} pending`}
                          </div>
                        )}
                      </div>
                      {!awaitingAcceptance && (
                        <a
                          href={`/ticket/${ticket.id}?preview=1`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="shrink-0 font-mono text-micro theme-muted underline hover:text-foreground transition-colors"
                        >
                          attendee preview ↗
                        </a>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {permissions.manageTickets &&
                        isLive &&
                        !awaitingAcceptance &&
                        !ticket.redeemedAt && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runTicketAction(ticket, "redeem")}
                            className="min-h-11 rounded border theme-border px-3 font-mono text-micro font-bold hover:opacity-70 disabled:opacity-50"
                          >
                            check in
                          </button>
                        )}
                      {permissions.manageTickets && isLive && ticket.redeemedAt && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runTicketAction(ticket, "unredeem")}
                          className="min-h-11 rounded border theme-border px-3 font-mono text-micro theme-muted hover:opacity-70 disabled:opacity-50"
                        >
                          undo check-in
                        </button>
                      )}
                      {permissions.manageTickets &&
                        isLive &&
                        !awaitingAcceptance &&
                        ticket.email && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runTicketAction(ticket, "resend")}
                            className="min-h-11 rounded border theme-border px-3 font-mono text-micro font-bold text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-50"
                          >
                            resend email
                          </button>
                        )}
                      {permissions.executeRefunds && isLive && paid && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runTicketAction(ticket, "refund")}
                          className="min-h-11 rounded border theme-border px-3 font-mono text-micro text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-50"
                        >
                          refund order
                        </button>
                      )}
                      {permissions.manageTickets && isLive && !awaitingAcceptance && !paid && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runTicketAction(ticket, "void")}
                          className="min-h-11 rounded border theme-border px-3 font-mono text-micro text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-50"
                        >
                          cancel ticket
                        </button>
                      )}
                      {permissions.manageTickets && !awaitingAcceptance && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setEditingTicket((current) =>
                              current?.id === ticket.id
                                ? null
                                : {
                                    id: ticket.id,
                                    name: ticket.holderName,
                                    email: ticket.email ?? "",
                                  },
                            )
                          }
                          className="min-h-11 px-2 font-mono text-micro theme-muted underline hover:opacity-70 disabled:opacity-50"
                        >
                          edit
                        </button>
                      )}
                      {permissions.manageTickets &&
                        isLive &&
                        !awaitingAcceptance &&
                        !ticket.redeemedAt &&
                        !ticket.activeExchange &&
                        event.ticketTypes.length > 1 && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setExchangingTicket((current) =>
                                current?.id === ticket.id
                                  ? null
                                  : {
                                      id: ticket.id,
                                      holderName: ticket.holderName,
                                      fromTicketTypeId: ticket.ticketTypeId,
                                      targetTicketTypeId: "",
                                    },
                              )
                            }
                            className="min-h-11 px-2 font-mono text-micro theme-muted underline hover:opacity-70 disabled:opacity-50"
                          >
                            change type
                          </button>
                        )}
                      {busy && <span className="font-mono text-micro theme-faint">working…</span>}
                    </div>
                    {editingTicket?.id === ticket.id && (
                      <form
                        onSubmit={(formEvent) => {
                          formEvent.preventDefault();
                          void saveHolder();
                        }}
                        className="admin-form-row mt-2 grid gap-2 rounded border theme-border p-2 sm:grid-cols-[1fr_1fr_auto]"
                      >
                        <Field
                          label="name"
                          value={editingTicket.name}
                          onChange={(value) =>
                            setEditingTicket((current) =>
                              current ? { ...current, name: value } : current,
                            )
                          }
                        />
                        <Field
                          label="email"
                          type="email"
                          value={editingTicket.email}
                          onChange={(value) =>
                            setEditingTicket((current) =>
                              current ? { ...current, email: value } : current,
                            )
                          }
                          hint="blank removes the address"
                        />
                        <AdminFormAction>
                          <button
                            type="submit"
                            disabled={busy || !editingTicket.name.trim()}
                            className="min-h-10 rounded bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
                          >
                            save
                          </button>
                        </AdminFormAction>
                      </form>
                    )}
                    {exchangingTicket?.id === ticket.id && (
                      <form
                        onSubmit={(formEvent) => {
                          formEvent.preventDefault();
                          void exchangeTicket();
                        }}
                        className="admin-form-row mt-2 grid gap-2 rounded border theme-border p-2 sm:grid-cols-[1fr_auto]"
                      >
                        <label className="admin-form-field block">
                          <span className="font-mono text-micro theme-muted tracking-wide">
                            change to
                          </span>
                          <AppSelect
                            value={exchangingTicket.targetTicketTypeId}
                            onValueChange={(value) =>
                              setExchangingTicket((current) =>
                                current ? { ...current, targetTicketTypeId: value } : current,
                              )
                            }
                            options={[
                              { value: "", label: "choose a ticket type" },
                              ...event.ticketTypes
                                .filter((type) => type.id !== ticket.ticketTypeId)
                                .map((type) => {
                                  const soldOut = (summary.byType[type.id]?.remaining ?? 0) === 0;
                                  return {
                                    value: type.id,
                                    label: `${type.name} — ${formatMoney(type.priceMinor, type.currency)}${soldOut ? " (sold out)" : ""}`,
                                    disabled: soldOut,
                                  };
                                }),
                            ]}
                            variant="field"
                            ariaLabel="Change ticket type"
                            className="mt-1"
                          />
                        </label>
                        <AdminFormAction>
                          <button
                            type="submit"
                            disabled={busy || !exchangingTicket.targetTicketTypeId}
                            className="min-h-11 rounded bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
                          >
                            review change
                          </button>
                        </AdminFormAction>
                      </form>
                    )}
                    {exchangePaymentLink?.ticketId === ticket.id && (
                      <div className="mt-2 rounded border theme-border p-3">
                        <p className="font-mono text-micro theme-subtle leading-relaxed">
                          Send this Stripe link to the purchaser. Their ticket changes only after
                          the difference is paid.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <a
                            href={exchangePaymentLink.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="min-h-11 content-center font-mono text-micro underline hover:opacity-70"
                          >
                            open payment link ↗
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              void navigator.clipboard.writeText(exchangePaymentLink.url)
                            }
                            className="min-h-11 font-mono text-micro underline hover:opacity-70"
                          >
                            copy link
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTool === "messages" && permissions.manageCommunications ? (
        <MessageComposer
          event={event}
          summary={summary}
          authFetch={authFetch}
          onError={onError}
          onStatus={onStatus}
          confirmAction={confirmAction}
        />
      ) : null}

      {activeTool === "waitlist" && permissions.manageEvents ? (
        <EventWaitlistPanel eventSlug={event.slug} authFetch={authFetch} onError={onError} />
      ) : null}

      {activeTool === "door" && permissions.manageEvents ? (
        <ScanningSection
          event={event}
          authFetch={authFetch}
          onError={onError}
          onStatus={onStatus}
          confirmAction={confirmAction}
          stepUp={stepUp}
        />
      ) : null}

      {activeTool === "uploads" && permissions.manageEvents ? (
        <GuestUploadsSection
          event={event}
          authFetch={authFetch}
          onError={onError}
          onStatus={onStatus}
          confirmAction={confirmAction}
        />
      ) : null}
    </div>
  );
}

type EventStaffAccessData = {
  staff: AdminStaffAssignment[];
  staffRoles: AdminStaffRole[];
};

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
