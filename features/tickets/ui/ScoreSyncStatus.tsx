import { useEffect, useRef, useState } from "react";

import { EventScoringClientStore } from "@/features/event-scoring/client-sync-store";
import {
  isScoreSyncResponse,
  MinimumFetchGap,
  nextRetryDelayMs,
  reconcileSnapshot,
  scoreSnapshotFromResponse,
  shouldRetryScoreResponse,
  type ScoreSnapshot,
} from "@/features/event-scoring/client-sync";

const NORMAL_REFRESH_MS = 30_000;
const MINIMUM_FETCH_GAP_MS = 5_000;
const LEASE_MS = 12_000;

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
  const [online, setOnline] = useState(true);
  const [lastSynchronizedAt, setLastSynchronizedAt] = useState(snapshot.synchronizedAt);
  const onSnapshotRef = useRef(onSnapshot);
  const snapshotRef = useRef(snapshot);
  onSnapshotRef.current = onSnapshot;
  snapshotRef.current = snapshot;
  const { eventSlug, participantId } = snapshot;
  useEffect(() => {
    localStorage.setItem("mah-has-score-session", "1");
    setOnline(navigator.onLine);
    const store = new EventScoringClientStore();
    const initial = snapshotRef.current;
    let current = initial;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const owner = crypto.randomUUID();
    const key = leaseKey(eventSlug, participantId);
    const gap = new MinimumFetchGap(MINIMUM_FETCH_GAP_MS);

    void store.saveSnapshot(initial);

    const schedule = (delay = NORMAL_REFRESH_MS) => {
      clearTimeout(timer);
      if (active) timer = setTimeout(() => void refresh(), delay);
    };
    const refresh = async (force = false) => {
      if (!active || !navigator.onLine || document.visibilityState === "hidden") return;
      if (!force && !gap.canFetch()) return schedule(MINIMUM_FETCH_GAP_MS);
      if (!acquireLease(key, owner)) return schedule(LEASE_MS);
      gap.markFetched();
      let status: number | undefined;
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score`, {
          headers: { accept: "application/json" },
        });
        status = response.status;
        if (!response.ok) throw new Error(`Score refresh failed (${response.status})`);
        const body: unknown = await response.json();
        if (!isScoreSyncResponse(body)) throw new Error("Score refresh returned invalid data");
        const incoming = scoreSnapshotFromResponse(eventSlug, body);
        current = reconcileSnapshot(current, incoming);
        attempts = 0;
        setOnline(true);
        setLastSynchronizedAt(current.synchronizedAt);
        await store.saveSnapshot(current);
        onSnapshotRef.current?.(current);
        schedule();
      } catch {
        if (!active) return;
        setOnline(navigator.onLine);
        attempts += 1;
        if (shouldRetryScoreResponse(status, attempts)) schedule(nextRetryDelayMs(attempts));
      }
    };
    const updateNetwork = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void refresh(true);
    };
    const updateVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const wake = () => void refresh();
    const unsubscribe = store.subscribe(wake);
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener("mah-score-wake", wake);
    document.addEventListener("visibilitychange", updateVisibility);
    schedule();
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
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
  return (
    <span>
      {online
        ? `synchronized ${new Date(lastSynchronizedAt).toLocaleTimeString()}`
        : "offline - showing last confirmed score"}
    </span>
  );
}
