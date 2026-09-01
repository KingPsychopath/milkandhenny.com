import { useCallback, useEffect, useRef, useState } from "react";

import { getTicketArrivalStateFn } from "@/features/event-operations/ticket-arrival.functions";
import { subscribeTicketStream } from "./ticket-event-stream";

const FALLBACK_POLL_MS = 7_000;
const MIN_RECONCILE_GAP_MS = 1_500;

export function useTicketAdmissionState({
  ticketReference,
  initialRedeemedAt,
  enabled,
}: {
  ticketReference: string;
  initialRedeemedAt?: string;
  enabled: boolean;
}) {
  const [redeemedAt, setRedeemedAt] = useState(initialRedeemedAt);
  const lastCheckedAt = useRef(0);
  const stopped = useRef(false);
  const reconcile = useCallback(async () => {
    if (!enabled || stopped.current || Date.now() - lastCheckedAt.current < MIN_RECONCILE_GAP_MS) {
      return;
    }
    lastCheckedAt.current = Date.now();
    const state = await getTicketArrivalStateFn({ data: { ticketReference } }).catch(() => null);
    if (!state?.found) {
      if (state && !state.found) stopped.current = true;
      return;
    }
    setRedeemedAt(state.redeemedAt);
  }, [enabled, ticketReference]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeTicketStream(ticketReference, (event) => {
      if (event.kind !== "unavailable") void reconcile();
    });
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), FALLBACK_POLL_MS);
    const onFocus = () => void reconcile();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, reconcile, ticketReference]);

  return redeemedAt;
}
