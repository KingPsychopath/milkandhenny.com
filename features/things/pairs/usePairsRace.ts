import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";
import { commandPairsRaceFn, readPairsRaceFn } from "./pairs-race.functions";
import type { PairsRaceAction, PairsRaceSnapshot } from "./pairs-race-rules";
import type { PairsRaceSession } from "./pairs-race-session.client";

export function usePairsRace(session: PairsRaceSession) {
  const [snapshot, setSnapshot] = useState<PairsRaceSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const pending = useRef<(PairsRaceSession & { actionId: string; action: PairsRaceAction }) | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    controller.current = new AbortController();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const accept = useCallback((next: PairsRaceSnapshot) => {
    if (!mounted.current) return;
    setSnapshot((previous) =>
      !previous ||
      next.revision > previous.revision ||
      (next.revision === previous.revision && next.serverNow >= previous.serverNow)
        ? next
        : previous,
    );
  }, []);
  const refresh = useVisibilityReconciler({
    enabled: !ended,
    identity: `${session.roomId}:${session.playerId}`,
    intervalMs: 900,
    minimumGapMs: 750,
    reconcile: async (isCurrent) => {
      const before = Date.now();
      try {
        const next = await readPairsRaceFn({ data: session, signal: controller.current?.signal });
        if (!isCurrent() || !mounted.current) return;
        if (!next) {
          setEnded(true);
          setMessage("This table or player session has expired.");
          return;
        }
        setClockOffset(next.serverNow - (before + Date.now()) / 2);
        setMessage((previous) => (previous === "Reconnecting to the table…" ? null : previous));
        accept(next);
      } catch (cause) {
        if (!isCurrent() || !mounted.current) return;
        const status =
          cause &&
          typeof cause === "object" &&
          "status" in cause &&
          typeof cause.status === "number"
            ? cause.status
            : 0;
        if (status >= 400 && status < 500) setEnded(true);
        setMessage(
          status >= 400 && status < 500
            ? "This player session is unavailable."
            : "Reconnecting to the table…",
        );
      }
    },
  });
  async function send(action?: PairsRaceAction) {
    if (busy || ended || (pending.current && action)) return;
    if (action) pending.current = { ...session, actionId: crypto.randomUUID(), action };
    const request = pending.current;
    if (!request) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await commandPairsRaceFn({
        data: request,
        signal: controller.current?.signal,
      });
      if (!mounted.current) return;
      pending.current = null;
      setUncertain(false);
      if (result.snapshot) accept(result.snapshot);
      else setEnded(true);
      setMessage(result.error);
    } catch {
      if (!mounted.current) return;
      setUncertain(true);
      setMessage("The move may have landed. Retry it safely with the same move ID.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return {
    snapshot,
    message,
    busy: busy || uncertain,
    ended,
    clockOffset,
    send,
    retry: () => send(),
    refresh,
    uncertain,
  };
}
