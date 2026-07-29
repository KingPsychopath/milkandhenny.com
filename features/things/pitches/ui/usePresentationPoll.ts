import { useCallback, useEffect, useRef, useState } from "react";

import { readPresentationFn } from "../presentation.functions";
import type { PitchPresentationSnapshot } from "../types";

type Credentials =
  | { hostToken: string }
  | { controllerId: string; controllerToken: string }
  | undefined;

const POLL_MS = 800;
const MINIMUM_FETCH_GAP_MS = 650;

export function usePresentationPoll(roomId: string, credentials: Credentials) {
  const [snapshot, setSnapshot] = useState<PitchPresentationSnapshot>();
  const [message, setMessage] = useState("");
  const stopped = useRef(false);
  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);

  const refresh = useCallback(async () => {
    const now = Date.now();
    if (stopped.current || inFlight.current || now - lastFetchAt.current < MINIMUM_FETCH_GAP_MS) {
      return;
    }
    inFlight.current = true;
    lastFetchAt.current = now;
    try {
      const result = await readPresentationFn({
        data: credentials ? { roomId, ...credentials } : { roomId },
      });
      if (!result.ok) {
        setMessage(result.error);
        if (result.status >= 400 && result.status < 500) stopped.current = true;
        return;
      }
      setSnapshot(result.value);
      setMessage("");
    } catch {
      setMessage("Reconnecting…");
    } finally {
      inFlight.current = false;
    }
  }, [credentials, roomId]);

  useEffect(() => {
    stopped.current = false;
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  return { snapshot, setSnapshot, message, refresh };
}
