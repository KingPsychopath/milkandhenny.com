"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getDoorDataFn, redeemTicketFn } from "../tickets.functions";
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

function CameraFeed({ onCode, paused }: { onCode: (raw: string) => void; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(paused);
  const [message, setMessage] = useState("asking for camera access…");

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let animationFrame = 0;

    const stop = () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      const Detector = window.BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setMessage("No camera scanner here — type the ticket reference below.");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active || !videoRef.current) return stop();
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!active) return stop();
        setMessage("Point at their code.");
        const detector = new Detector({ formats: ["qr_code"] });

        const scanFrame = async () => {
          if (!active || !videoRef.current) return;
          if (!pausedRef.current) {
            try {
              const codes = await detector.detect(videoRef.current);
              const raw = codes[0]?.rawValue;
              if (raw) onCodeRef.current(raw);
            } catch {
              // Detection fails while the video warms up; the next frame retries.
            }
          }
          animationFrame = requestAnimationFrame(() => void scanFrame());
        };
        animationFrame = requestAnimationFrame(() => void scanFrame());
      } catch {
        setMessage("Camera access was refused — type the ticket reference below.");
      }
    };

    void start();
    return stop;
  }, []);

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border theme-border-strong bg-black/80">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview for scanning tickets"
          className="h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[14%] rounded-xl border-2 border-white/70"
        />
      </div>
      <p aria-live="polite" className="mt-2 text-center font-mono text-micro theme-muted">
        {message}
      </p>
    </div>
  );
}

export function DoorScanner({
  eventSlug,
  eventTitle,
  initialManifest,
  initialTickets,
  initialSummary,
}: {
  eventSlug: string;
  eventTitle: string;
  initialManifest: string[];
  initialTickets: (DoorTicketView & { issuedAt: string })[];
  initialSummary: { total: number; redeemed: number };
}) {
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
      const data = await getDoorDataFn({ data: { eventSlug } });
      if (!data.authorised) return;
      setOffline((state) => applyManifest(state, data.manifestHashes));
      setTickets(data.tickets);
      setSummary(data.summary);
    } catch {
      // A failed refresh is survivable: the cached manifest still works.
    }
  }, [eventSlug]);

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
  }, [eventSlug]);

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
            data: { scanned: raw, eventSlug, redeemedBy: "door" },
          });

          if (!result.authorised) {
            setVerdict({
              kind: "rejected",
              title: "Signed out",
              detail: "Staff session expired — sign in again.",
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
    [eventSlug, tickets],
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
    return tickets.filter((ticket) => ticket.holderName.toLowerCase().includes(term)).slice(0, 8);
  }, [query, tickets]);

  const pending = pendingCount(offline);

  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="mx-auto max-w-md px-5 pb-16 pt-8">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="font-mono text-sm text-foreground">{eventTitle}</h1>
          <p className="font-mono text-micro theme-muted">
            {summary.redeemed}/{summary.total} in
          </p>
        </header>

        {(!online || pending > 0) && (
          <p className="mt-3 rounded-lg border theme-border-strong px-3 py-2 font-mono text-micro text-foreground">
            {online
              ? `syncing ${pending} offline scan${pending === 1 ? "" : "s"}…`
              : `offline — scanning against the downloaded list${pending > 0 ? `, ${pending} queued` : ""}`}
          </p>
        )}

        {/* Verdict sits above the camera: it is what staff actually look at. */}
        <div
          aria-live="assertive"
          className={`mt-4 min-h-24 rounded-2xl px-4 py-4 text-center ${
            verdict.kind === "idle" ? "border theme-border" : verdictStyle(verdict.kind)
          }`}
        >
          {verdict.kind === "idle" ? (
            <p className="pt-5 font-mono text-xs theme-muted">ready</p>
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
            search by name
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
