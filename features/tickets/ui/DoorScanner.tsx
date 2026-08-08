"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CameraFeed } from "./CameraFeed";
import { getDoorDataFn, redeemTicketFn } from "../tickets.functions";
import {
  guestRequestCancelFn,
  guestRequestDecideFn,
  guestRequestsFn,
  guestSubmitFn,
} from "../scanner.functions";
import {
  ROLE_DEFAULT_PERMISSIONS,
  type GuestRequestRecord,
  type ScannerPermissionSet,
  type ScannerRole,
} from "../checkpoint-types";
import {
  EMPTY_DOOR_STATE,
  applyManifest,
  clearSynced,
  pendingCount,
  recordOfflineScan,
  type DoorOfflineState,
} from "../door-queue";
import {
  hashTicketIdInBrowser,
  isValidTicketId,
  parseTicketQrPayload,
  type DoorTicketView,
} from "../types";

/**
 * The door.
 *
 * Scanner-first with search as the fallback — the old guest list was
 * search-first, which is the slow path when there is a queue outside.
 * Everything is sized to be read at arm's length in bad light by someone
 * holding a phone in one hand.
 *
 * Polling follows the rules from the guest-list KV postmortem: the callback
 * is ref-stable so a re-render cannot restart the effect, and there is a hard
 * floor between fetches regardless of what any future refactor asks for.
 */

const MIN_REFRESH_GAP_MS = 15_000;
const REFRESH_INTERVAL_MS = 60_000;

type Verdict =
  | { kind: "idle" }
  | { kind: "admitted"; name: string; detail: string }
  | { kind: "already"; name: string; detail: string }
  | { kind: "rejected"; title: string; detail: string }
  | { kind: "queued"; name: string; detail: string };

type ScanResult = "admitted" | "queued" | "already" | "rejected";

type PendingGroup = {
  raw: string;
  anchor: DoorTicketView;
  tickets: DoorTicketView[];
};

/**
 * "(+) add guest" for shared-link doors.
 *
 * A scanner raises a request and quietly tracks it — amber count, tap to
 * see or withdraw. A manager adds instantly and decides everyone else's
 * requests from the same panel.
 */
function GuestRequests({
  token,
  permissions,
  requests,
  onRequestsChanged,
  onGuestAdded,
}: {
  token: string;
  permissions: ScannerPermissionSet;
  requests: GuestRequestRecord[];
  onRequestsChanged: (requests: GuestRequestRecord[]) => void;
  onGuestAdded: () => void;
}) {
  const canAdd = permissions.addGuests;
  const canApprove = permissions.approveRequests;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Approve is two taps: the first arms it, the second commits. */
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await guestRequestsFn({ data: { token } });
      if (result.authorised) onRequestsChanged(result.requests);
    } catch {
      // The list refreshes again on the next action.
    }
  }, [token, onRequestsChanged]);

  const pending = requests.filter((request) => request.status === "pending");
  const recentlyDecided = requests
    .filter((request) => request.status === "approved" || request.status === "declined")
    .slice(0, 3);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await guestSubmitFn({ data: { token, name: name.trim() } });
      if (!result.authorised) {
        setNotice("This link is no longer active.");
        return;
      }
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setName("");
      if (result.mode === "added") {
        setNotice(`${result.holderName} is on the list.`);
        onGuestAdded();
      } else {
        setNotice("Sent — the organiser will approve it.");
      }
      await refresh();
    } catch {
      setNotice("No signal — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: number) => {
    setBusy(true);
    try {
      await guestRequestCancelFn({ data: { token, id } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: number, approve: boolean) => {
    setBusy(true);
    setConfirmingId(null);
    try {
      const result = await guestRequestDecideFn({ data: { token, id, approve } });
      if (result.authorised && result.ok && approve) onGuestAdded();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="font-mono text-micro theme-muted hover:text-foreground transition-colors"
        >
          + add guest
        </button>
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-mono text-micro text-[var(--things-amber)]"
          >
            {canApprove ? `${pending.length} to approve` : `${pending.length} pending`}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-2xl border theme-border p-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex gap-2"
          >
            <label htmlFor="guest-name" className="sr-only">
              Guest name
            </label>
            <input
              id="guest-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              placeholder="guest's name"
              className="min-h-11 min-w-0 flex-1 rounded-lg border theme-border-strong bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="min-h-11 shrink-0 rounded-lg bg-foreground px-3 font-mono text-micro text-background disabled:opacity-50"
            >
              {canAdd ? "add" : "request"}
            </button>
          </form>
          {notice && <p className="mt-2 font-mono text-micro theme-muted">{notice}</p>}

          {pending.length > 0 && (
            <ul className="mt-3 divide-y theme-border border-t theme-border">
              {pending.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-foreground">{request.name}</p>
                    <p className="font-mono text-micro theme-muted">
                      {canApprove ? `asked by ${request.requestedBy}` : "waiting"}
                    </p>
                  </div>
                  {canApprove ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (confirmingId === request.id) {
                            setConfirmingId(null);
                            void decide(request.id, true);
                          } else {
                            setConfirmingId(request.id);
                          }
                        }}
                        className={`min-h-9 rounded-lg px-3 font-mono text-micro disabled:opacity-50 ${
                          confirmingId === request.id
                            ? "bg-[var(--things-green)] text-black"
                            : "bg-foreground text-background"
                        }`}
                      >
                        {confirmingId === request.id ? "sure? tap again" : "approve"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void decide(request.id, false)}
                        className="min-h-9 rounded-lg border theme-border-strong px-3 font-mono text-micro text-foreground disabled:opacity-50"
                      >
                        decline
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void cancel(request.id)}
                      className="shrink-0 min-h-9 px-2 font-mono text-micro theme-muted hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      cancel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!canApprove && recentlyDecided.length > 0 && (
            <ul className="mt-2 border-t theme-border pt-2">
              {recentlyDecided.map((request) => (
                <li key={request.id} className="flex justify-between py-1 font-mono text-micro">
                  <span className="truncate theme-muted">{request.name}</span>
                  <span
                    className={
                      request.status === "approved" ? "text-[var(--things-green)]" : "theme-faint"
                    }
                  >
                    {request.status === "approved" ? "approved ✓" : "declined"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function verdictStyle(kind: Verdict["kind"]): string {
  switch (kind) {
    case "admitted":
      return "bg-[var(--things-green)] text-black";
    case "queued":
      return "bg-[var(--things-amber)] text-black";
    case "already":
      return "bg-[var(--things-amber)] text-black";
    case "rejected":
      return "bg-[var(--things-country-outside)] text-white";
    default:
      return "";
  }
}

export function DoorScanner({
  eventSlug,
  eventTitle,
  initialManifest,
  initialTickets,
  initialSummary,
  scannerToken,
  scannerRole = "scanner",
  scannerPermissions,
  initialRequests = [],
}: {
  eventSlug: string;
  eventTitle: string;
  initialManifest: string[];
  initialTickets: (DoorTicketView & { issuedAt: string })[];
  initialSummary: { total: number; redeemed: number };
  /** Present when this device is scanning via a shared link, not a staff session. */
  scannerToken?: string;
  scannerRole?: ScannerRole;
  scannerPermissions?: ScannerPermissionSet;
  initialRequests?: GuestRequestRecord[];
}) {
  const permissions = scannerPermissions ?? ROLE_DEFAULT_PERMISSIONS[scannerRole];
  const [offline, setOffline] = useState<DoorOfflineState>({
    ...EMPTY_DOOR_STATE,
    manifest: initialManifest,
  });
  const [tickets, setTickets] = useState(initialTickets);
  const [summary, setSummary] = useState(initialSummary);
  const [verdict, setVerdict] = useState<Verdict>({ kind: "idle" });
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [manualId, setManualId] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingGroup, setPendingGroup] = useState<PendingGroup | null>(null);
  const [showOccupancy, setShowOccupancy] = useState(false);
  const [guestRequests, setGuestRequests] = useState<GuestRequestRecord[]>(initialRequests);

  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastRefreshRef = useRef(0);
  const offlineRef = useRef(offline);

  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /** Refresh the manifest and counts. Rate-floored so it can never run hot. */
  const refresh = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshRef.current < MIN_REFRESH_GAP_MS) return;
    lastRefreshRef.current = now;

    try {
      const data = await getDoorDataFn({ data: { eventSlug, scannerToken } });
      if (!data.authorised) return;
      setOffline((state) => applyManifest(state, data.manifestHashes));
      setTickets(data.tickets);
      setSummary(data.summary);
    } catch {
      // A failed refresh is survivable: the cached manifest still works.
    }
  }, [eventSlug, scannerToken]);

  // Ref-stable interval — a re-render must never restart this effect.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => void refreshRef.current(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  /** Replay anything admitted while offline, once the signal returns. */
  const syncQueue = useCallback(async () => {
    const queue = offlineRef.current.queue;
    if (queue.length === 0 || !navigator.onLine) return;

    const synced: string[] = [];
    for (const entry of queue) {
      try {
        const result = await redeemTicketFn({
          data: {
            scanned: entry.ticketId,
            eventSlug,
            redeemedBy: "door-offline",
            offline: true,
            scannerToken,
          },
        });
        if (result.authorised) synced.push(entry.ticketId);
      } catch {
        // Leave it queued; the next reconnect retries.
        break;
      }
    }

    if (synced.length > 0) {
      setOffline((state) => clearSynced(state, synced));
      lastRefreshRef.current = 0;
      void refreshRef.current();
    }
  }, [eventSlug, scannerToken]);

  useEffect(() => {
    if (online) void syncQueue();
  }, [online, syncQueue]);

  const handleScan = useCallback(
    async (raw: string, bypassGroup = false): Promise<ScanResult> => {
      const now = Date.now();
      // Debounce: the camera fires many frames per second on one code.
      if (
        !bypassGroup &&
        lastScanRef.current &&
        lastScanRef.current.value === raw &&
        now - lastScanRef.current.at < 2_500
      ) {
        return "rejected";
      }
      lastScanRef.current = { value: raw, at: now };

      const parsed = parseTicketQrPayload(raw);
      const typedId = raw.trim().toUpperCase();
      const ticketId = parsed?.ticketId ?? (isValidTicketId(typedId) ? typedId : null);

      if (!ticketId) {
        setVerdict({ kind: "rejected", title: "Not a ticket", detail: "That code isn't ours." });
        return "rejected";
      }

      const known = tickets.find((ticket) => ticket.id === ticketId);
      if (!bypassGroup && known?.status === "valid" && !known.redeemedAt) {
        const queuedIds = new Set(offlineRef.current.queue.map((entry) => entry.ticketId));
        const availableGroup = tickets.filter(
          (ticket) =>
            ticket.orderId === known.orderId &&
            ticket.status === "valid" &&
            !ticket.redeemedAt &&
            !queuedIds.has(ticket.id),
        );
        if (availableGroup.length > 1) {
          setPendingGroup({ raw, anchor: known, tickets: availableGroup });
          setVerdict({ kind: "idle" });
          return "rejected";
        }
      }

      setBusy(true);
      try {
        if (navigator.onLine) {
          const result = await redeemTicketFn({
            data: { scanned: raw, eventSlug, redeemedBy: "door", scannerToken },
          });

          if (!result.authorised) {
            setVerdict({
              kind: "rejected",
              title: scannerToken ? "Link no longer active" : "Signed out",
              detail: scannerToken
                ? "This scanner link was turned off — ask the organiser for a fresh one."
                : "Staff session expired — sign in again.",
            });
            return "rejected";
          }

          const outcome = result.outcome;
          switch (outcome.result) {
            case "admitted":
              setVerdict({
                kind: "admitted",
                name: outcome.ticket.holderName,
                detail: outcome.ticket.ticketTypeName,
              });
              setSummary((prev) => ({ ...prev, redeemed: prev.redeemed + 1 }));
              setTickets((current) =>
                current.map((entry) =>
                  entry.id === outcome.ticket.id
                    ? { ...entry, redeemedAt: new Date().toISOString() }
                    : entry,
                ),
              );
              break;
            case "already-redeemed":
              setVerdict({
                kind: "already",
                name: outcome.ticket.holderName,
                detail: `Already scanned in at ${new Date(outcome.redeemedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
              });
              break;
            case "wrong-event":
              setVerdict({
                kind: "rejected",
                title: "Wrong event",
                detail: "That ticket is for a different night.",
              });
              break;
            case "void":
              setVerdict({
                kind: "rejected",
                title: "Not valid",
                detail: "This ticket was cancelled or refunded.",
              });
              break;
            default:
              setVerdict({
                kind: "rejected",
                title: "No ticket",
                detail: "Nothing matches that code.",
              });
          }
          return outcome.result === "admitted"
            ? "admitted"
            : outcome.result === "already-redeemed"
              ? "already"
              : "rejected";
        }

        // Offline: decide from the manifest and queue the redemption.
        const ticketHash = await hashTicketIdInBrowser(ticketId);
        const outcome = recordOfflineScan(offlineRef.current, {
          ticketId,
          ticketHash,
          scannedAt: new Date().toISOString(),
        });
        offlineRef.current = outcome.state;
        setOffline(outcome.state);

        if (outcome.result === "admitted-offline") {
          setSummary((prev) => ({ ...prev, redeemed: prev.redeemed + 1 }));
          setTickets((current) =>
            current.map((entry) =>
              entry.id === ticketId ? { ...entry, redeemedAt: new Date().toISOString() } : entry,
            ),
          );
          setVerdict({
            kind: "queued",
            name: known?.holderName ?? ticketId,
            detail: "Let them in — will sync when back online.",
          });
          return "queued";
        } else if (outcome.result === "already-redeemed-offline") {
          setVerdict({
            kind: "already",
            name: known?.holderName ?? ticketId,
            detail: "Already scanned on this device.",
          });
          return "already";
        } else {
          setVerdict({
            kind: "rejected",
            title: "Not on the list",
            detail: "No signal, and this ticket isn't in the downloaded list.",
          });
          return "rejected";
        }
      } finally {
        setBusy(false);
      }
    },
    [eventSlug, tickets, scannerToken],
  );

  const admitPendingGroup = useCallback(async () => {
    const group = pendingGroup;
    if (!group) return;

    setPendingGroup(null);
    setBulkBusy(true);
    let admitted = 0;
    let queued = 0;
    try {
      for (const ticket of group.tickets) {
        const result = await handleScan(ticket.id, true);
        if (result === "admitted") admitted += 1;
        if (result === "queued") queued += 1;
      }
    } finally {
      setBulkBusy(false);
    }

    const accepted = admitted + queued;
    if (accepted > 0) {
      setVerdict({
        kind: queued > 0 ? "queued" : "admitted",
        name: `${accepted} guest${accepted === 1 ? "" : "s"}`,
        detail:
          queued > 0
            ? "Group checked in — will sync when back online."
            : `Group checked in · ${group.anchor.ticketTypeName}`,
      });
    }
  }, [handleScan, pendingGroup]);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return tickets
      .filter(
        (ticket) =>
          ticket.holderName.toLowerCase().includes(term) ||
          ticket.id.toLowerCase().startsWith(term),
      )
      .slice(0, 8);
  }, [query, tickets]);

  const occupancy = useMemo(() => {
    const live = tickets.filter((ticket) => ticket.status === "valid");
    const inside = live
      .filter((ticket) => ticket.redeemedAt)
      .sort((a, b) => (b.redeemedAt ?? "").localeCompare(a.redeemedAt ?? ""));
    const expected = live
      .filter((ticket) => !ticket.redeemedAt)
      .sort((a, b) => a.holderName.localeCompare(b.holderName));
    // Per-order tallies, so "how many of their lot are in?" reads at a glance.
    const orders = new Map<string, { inside: number; total: number }>();
    for (const ticket of live) {
      const entry = orders.get(ticket.orderId) ?? { inside: 0, total: 0 };
      entry.total += 1;
      if (ticket.redeemedAt) entry.inside += 1;
      orders.set(ticket.orderId, entry);
    }
    return { inside, expected, orders };
  }, [tickets]);

  const [occupancyQuery, setOccupancyQuery] = useState("");
  const occupancyFilter = occupancyQuery.trim().toLowerCase();
  const filterTickets = (list: (DoorTicketView & { issuedAt: string })[]) =>
    occupancyFilter
      ? list.filter((ticket) => ticket.holderName.toLowerCase().includes(occupancyFilter))
      : list;
  const groupChip = (ticket: DoorTicketView) => {
    const stats = occupancy.orders.get(ticket.orderId);
    return stats && stats.total > 1 ? `${stats.inside}/${stats.total} of group in` : null;
  };

  const pending = pendingCount(offline);

  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="mx-auto max-w-md px-5 pb-16 pt-8">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="font-mono text-sm text-foreground">{eventTitle}</h1>
          <button
            type="button"
            onClick={() => setShowOccupancy((current) => !current)}
            aria-expanded={showOccupancy}
            className="font-mono text-micro theme-muted underline decoration-dotted underline-offset-4 hover:text-foreground transition-colors"
          >
            {summary.redeemed}/{summary.total} in {showOccupancy ? "▴" : "▾"}
          </button>
        </header>

        {showOccupancy && (
          <section aria-label="Who is inside" className="mt-3 rounded-2xl border theme-border p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="font-mono text-xl text-foreground">{occupancy.inside.length}</p>
                <p className="font-mono text-micro theme-muted">inside</p>
              </div>
              <div>
                <p className="font-mono text-xl text-foreground">{occupancy.expected.length}</p>
                <p className="font-mono text-micro theme-muted">still to come</p>
              </div>
              <div>
                <p className="font-mono text-xl text-foreground">{summary.total}</p>
                <p className="font-mono text-micro theme-muted">expected</p>
              </div>
            </div>

            <label htmlFor="occupancy-filter" className="sr-only">
              Filter by name
            </label>
            <input
              id="occupancy-filter"
              type="search"
              value={occupancyQuery}
              onChange={(event) => setOccupancyQuery(event.target.value)}
              placeholder="filter by name…"
              className="mt-3 min-h-11 w-full rounded-lg border theme-border bg-transparent px-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
            />

            {(() => {
              const insideRows = filterTickets(occupancy.inside);
              const expectedRows = filterTickets(occupancy.expected);
              if (insideRows.length === 0 && expectedRows.length === 0) {
                return (
                  <p className="mt-3 font-mono text-micro theme-faint">nobody matches that name</p>
                );
              }
              return (
                <>
                  {insideRows.length > 0 && (
                    <>
                      <p className="mt-4 font-mono text-micro theme-muted tracking-wide">
                        inside · latest first
                      </p>
                      <ul className="mt-1 max-h-40 overflow-y-auto">
                        {insideRows.map((ticket) => (
                          <li
                            key={ticket.id}
                            className="flex items-baseline justify-between gap-3 py-1 font-mono text-xs"
                          >
                            <span className="min-w-0 truncate text-foreground">
                              {ticket.holderName}
                              {groupChip(ticket) && (
                                <span className="ml-2 theme-muted">· {groupChip(ticket)}</span>
                              )}
                            </span>
                            <span className="shrink-0 theme-muted">
                              {ticket.redeemedAt
                                ? new Date(ticket.redeemedAt).toLocaleTimeString("en-GB", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {expectedRows.length > 0 && (
                    <>
                      <p className="mt-4 font-mono text-micro theme-muted tracking-wide">
                        still to come
                      </p>
                      <ul className="mt-1 max-h-40 overflow-y-auto">
                        {expectedRows.map((ticket) => (
                          <li
                            key={ticket.id}
                            className="truncate py-1 font-mono text-xs theme-muted"
                          >
                            {ticket.holderName}
                            {groupChip(ticket) && <span> · {groupChip(ticket)}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {(!online || pending > 0) && (
          <p className="mt-3 rounded-lg border theme-border-strong px-3 py-2 font-mono text-micro text-foreground">
            {online
              ? `syncing ${pending} offline scan${pending === 1 ? "" : "s"}…`
              : `offline — scanning against the downloaded list${pending > 0 ? `, ${pending} queued` : ""}`}
          </p>
        )}

        {scannerToken && (permissions.addGuests || permissions.requestGuests) && (
          <GuestRequests
            token={scannerToken}
            permissions={permissions}
            requests={guestRequests}
            onRequestsChanged={setGuestRequests}
            onGuestAdded={() => {
              lastRefreshRef.current = 0;
              void refreshRef.current();
            }}
          />
        )}

        {/* Verdict sits above the camera: it is what staff actually look at.
            Idle keeps almost no height — the box only earns its size once
            there is a verdict worth reading. */}
        <div
          aria-live="assertive"
          className={
            verdict.kind === "idle"
              ? "mt-3 text-center"
              : `mt-4 min-h-24 rounded-2xl px-4 py-4 text-center ${verdictStyle(verdict.kind)}`
          }
        >
          {verdict.kind === "idle" ? (
            <p className="font-mono text-micro theme-faint">ready — point at a code</p>
          ) : verdict.kind === "rejected" ? (
            <>
              <p className="font-mono text-lg font-bold">{verdict.title}</p>
              <p className="mt-1 font-mono text-xs opacity-90">{verdict.detail}</p>
            </>
          ) : (
            <>
              <p className="font-serif text-2xl font-bold leading-tight">{verdict.name}</p>
              <p className="mt-1 font-mono text-xs opacity-90">
                {verdict.kind === "admitted" ? `in — ${verdict.detail}` : verdict.detail}
              </p>
            </>
          )}
        </div>

        {pendingGroup && (
          <section
            aria-labelledby="door-group-title"
            className="mt-4 rounded-2xl border theme-border-strong p-4"
          >
            <p id="door-group-title" className="font-serif text-xl text-foreground">
              {pendingGroup.tickets.length} people on this order
            </p>
            <p className="mt-1 font-mono text-micro theme-muted">Who is coming in right now?</p>
            <ul className="mt-3 divide-y theme-border border-y theme-border">
              {pendingGroup.tickets.map((ticket) => (
                <li
                  key={ticket.id}
                  className="flex items-center justify-between gap-3 py-2 font-mono text-xs"
                >
                  <span className="truncate text-foreground">{ticket.holderName}</span>
                  <span className="shrink-0 theme-muted">{ticket.ticketTypeName}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void admitPendingGroup()}
                className="min-h-12 rounded-lg bg-foreground px-4 font-mono text-xs text-background disabled:opacity-50"
              >
                check in all {pendingGroup.tickets.length}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const selected = pendingGroup;
                  setPendingGroup(null);
                  void handleScan(selected.raw, true);
                }}
                className="min-h-12 rounded-lg border theme-border-strong px-4 font-mono text-xs text-foreground disabled:opacity-50"
              >
                only {pendingGroup.anchor.holderName}
              </button>
              <button
                type="button"
                onClick={() => setPendingGroup(null)}
                className="min-h-10 font-mono text-micro theme-muted hover:text-foreground transition-colors"
              >
                cancel
              </button>
            </div>
          </section>
        )}

        <div className="mt-4">
          <CameraFeed
            onCode={(raw) => void handleScan(raw)}
            paused={busy || bulkBusy || pendingGroup !== null}
          />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (manualId.trim()) {
              void handleScan(manualId.trim());
              setManualId("");
            }
          }}
          className="mt-5 flex gap-2"
        >
          <label htmlFor="door-manual" className="sr-only">
            Ticket reference
          </label>
          <input
            id="door-manual"
            value={manualId}
            onChange={(event) => setManualId(event.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            placeholder="TICKET REFERENCE"
            className="min-h-12 min-w-0 flex-1 rounded-lg border theme-border-strong bg-transparent px-3 font-mono text-base tracking-[0.15em] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />
          <button
            type="submit"
            className="min-h-12 rounded-lg bg-foreground px-4 font-mono text-xs text-background"
          >
            check
          </button>
        </form>

        <section className="mt-8">
          <label htmlFor="door-search" className="font-mono text-micro theme-muted tracking-wide">
            search by name or ticket ref
          </label>
          <input
            id="door-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder="dead phone? find them here"
            className="mt-1 min-h-12 w-full rounded-lg border theme-border bg-transparent px-3 font-mono text-base text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--prose-hashtag)]"
          />

          <ul className="mt-2 divide-y theme-border">
            {matches.map((ticket) => (
              <li key={ticket.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-foreground">
                    {ticket.holderName}
                    {ticket.isPlusOne && <span className="theme-muted"> +1</span>}
                  </p>
                  <p className="font-mono text-micro theme-muted">
                    {ticket.ticketTypeName}
                    {ticket.redeemedAt ? " · already in" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleScan(ticket.id)}
                  className="shrink-0 min-h-10 rounded-lg border theme-border-strong px-3 font-mono text-micro text-foreground disabled:opacity-50"
                >
                  let in
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
