import { useEffect, useRef, useState } from "react";

import { EventScoringClientStore } from "@/features/event-scoring/client-sync-store";
import {
  createScoreRequestDeadline,
  isScoreSyncResponse,
  MinimumFetchGap,
  nextRetryDelayMs,
  reconcileSnapshot,
  rememberScoreSession,
  scoreSnapshotFromResponse,
  shouldRetryScoreResponse,
  type ScoreSnapshot,
} from "@/features/event-scoring/client-sync";
import { subscribeScoreStream } from "@/features/event-scoring/score-event-stream";

const NORMAL_REFRESH_MS = 5_000;
const MINIMUM_FETCH_GAP_MS = 5_000;
const LEASE_MS = 12_000;
const REQUEST_TIMEOUT_MS = 10_000;

function leaseKey(eventSlug: string, participantId: string) {
  return `mah-score-sync:${eventSlug}:${participantId}`;
}

function acquireLease(key: string, owner: string, now = Date.now()): boolean {
  try {
    const current = JSON.parse(localStorage.getItem(key) ?? "null") as {
      owner?: string;
      until?: number;
    } | null;
    if (current?.owner !== owner && typeof current?.until === "number" && current.until > now)
      return false;
    localStorage.setItem(key, JSON.stringify({ owner, until: now + LEASE_MS }));
    return true;
  } catch {
    return true;
  }
}

export function ScoreSyncStatus({
  snapshot,
  ticketId,
  onSnapshot,
}: {
  snapshot: ScoreSnapshot;
  ticketId: string;
  onSnapshot?: (snapshot: ScoreSnapshot) => void;
}) {
  const [status, setStatus] = useState<"checking" | "confirmed" | "offline" | "reconnecting">(
    "confirmed",
  );
  const onSnapshotRef = useRef(onSnapshot);
  const snapshotRef = useRef(snapshot);
  onSnapshotRef.current = onSnapshot;
  snapshotRef.current = snapshot;
  const { eventSlug, participantId } = snapshot;
  useEffect(() => {
    rememberScoreSession({ eventSlug, ticketId });
    setStatus(navigator.onLine ? "confirmed" : "offline");
    const store = new EventScoringClientStore();
    const initial = snapshotRef.current;
    let current = initial;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestDeadline: ReturnType<typeof createScoreRequestDeadline> | undefined;
    let attempts = 0;
    const owner = crypto.randomUUID();
    const key = leaseKey(eventSlug, participantId);
    const gap = new MinimumFetchGap(MINIMUM_FETCH_GAP_MS);

    void store.saveSnapshot(initial).catch(() => undefined);

    const schedule = (delay = NORMAL_REFRESH_MS) => {
      clearTimeout(timer);
      if (active) timer = setTimeout(() => void refresh(), delay);
    };
    const refresh = async (force = false) => {
      if (!active || !navigator.onLine || document.visibilityState === "hidden") return;
      if (!force && !gap.canFetch()) return schedule(MINIMUM_FETCH_GAP_MS);
      if (!acquireLease(key, owner)) return schedule(LEASE_MS);
      if (requestDeadline) return schedule(MINIMUM_FETCH_GAP_MS);
      gap.markFetched();
      let status: number | undefined;
      const deadline = createScoreRequestDeadline(REQUEST_TIMEOUT_MS);
      requestDeadline = deadline;
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score`, {
          headers: { accept: "application/json" },
          signal: deadline.signal,
        });
        status = response.status;
        if (!response.ok) throw new Error(`Score refresh failed (${response.status})`);
        const body: unknown = await response.json();
        if (!isScoreSyncResponse(body)) throw new Error("Score refresh returned invalid data");
        const previousRevision = current.revision;
        const incoming = scoreSnapshotFromResponse(eventSlug, body);
        current = reconcileSnapshot(current, incoming);
        attempts = 0;
        setStatus("confirmed");
        await store.saveSnapshot(current).catch(() => undefined);
        onSnapshotRef.current?.(current);
        if (current.revision > previousRevision) window.dispatchEvent(new Event("mah-score-wake"));
        schedule();
      } catch {
        if (!active) return;
        setStatus(navigator.onLine ? "reconnecting" : "offline");
        attempts += 1;
        if (shouldRetryScoreResponse(status, attempts)) schedule(nextRetryDelayMs(attempts));
        else if (status === undefined || status >= 500) schedule(30_000);
      } finally {
        deadline.clear();
        if (requestDeadline === deadline) requestDeadline = undefined;
      }
    };
    const updateNetwork = () => {
      setStatus(navigator.onLine ? "checking" : "offline");
      if (navigator.onLine) void refresh(true);
    };
    const updateVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const wake = () => void refresh();
    const unsubscribe = store.subscribe(wake);
    const unsubscribeStream = subscribeScoreStream(ticketId, (event) => {
      if (event.kind !== "unavailable") void refresh(true);
    });
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener("mah-score-wake", wake);
    document.addEventListener("visibilitychange", updateVisibility);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      requestDeadline?.abort();
      unsubscribe();
      unsubscribeStream();
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.removeEventListener("mah-score-wake", wake);
      document.removeEventListener("visibilitychange", updateVisibility);
      try {
        const lease = JSON.parse(localStorage.getItem(key) ?? "null") as { owner?: string } | null;
        if (lease?.owner === owner) localStorage.removeItem(key);
      } catch {
        // A blocked storage API must not break the ticket page.
      }
      store.close();
    };
  }, [eventSlug, participantId, ticketId]);
  const label =
    status === "confirmed"
      ? "server confirmed"
      : status === "offline"
        ? "offline — showing last confirmed score"
        : status === "reconnecting"
          ? "server unavailable — checking again"
          : "checking server confirmation";
  return (
    <span
      role="status"
      className={
        status === "confirmed" ? "text-[var(--status-positive)]" : "text-[var(--status-attention)]"
      }
    >
      <span aria-hidden="true">● </span>
      {label}
    </span>
  );
}
