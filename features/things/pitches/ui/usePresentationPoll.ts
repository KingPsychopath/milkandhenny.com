import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MULTIPLAYER_REALTIME_LIMITS } from "../../shared/multiplayer-realtime";
import { useMultiplayerWakeSocket } from "../../shared/useMultiplayerWakeSocket";
import { useRoomReconciler } from "../../shared/useRoomReconciler";
import { readPresentationFn } from "../presentation.functions";
import type { PitchPresentationSnapshot } from "../types";

type Credentials =
  | { hostToken: string }
  | { controllerId: string; controllerToken: string }
  | undefined;

/** Socket wakes drive presentation reads; the safety read catches a missed wake or a cold tab. */
export function usePresentationPoll(roomId: string, credentials: Credentials) {
  const [snapshot, setSnapshot] = useState<PitchPresentationSnapshot>();
  const [message, setMessage] = useState("");
  const [stopped, setStopped] = useState(false);
  const stoppedRef = useRef(false);

  const credentialKey = useMemo(() => {
    if (!credentials) return "public";
    return "hostToken" in credentials
      ? `host:${credentials.hostToken}`
      : `controller:${credentials.controllerId}:${credentials.controllerToken}`;
  }, [credentials]);
  const roomKey = `${roomId}:${credentialKey}`;

  useEffect(() => {
    stoppedRef.current = false;
    setStopped(false);
  }, [roomKey]);

  const reconcile = useCallback(
    async (isCurrent: () => boolean) => {
      if (stoppedRef.current) return;
      try {
        const result = await readPresentationFn({
          data: credentials ? { roomId, ...credentials } : { roomId },
        });
        if (!isCurrent()) return;
        if (!result.ok) {
          setMessage(result.error);
          if (result.status >= 400 && result.status < 500) {
            stoppedRef.current = true;
            setStopped(true);
          }
          return;
        }
        setSnapshot(result.value);
        setMessage("");
      } catch {
        if (isCurrent()) setMessage("Reconnecting…");
      }
    },
    [credentials, roomId],
  );

  const refresh = useRoomReconciler({
    enabled: !stopped,
    intervalMs: MULTIPLAYER_REALTIME_LIMITS.safetyReconciliationIntervalMs,
    roomKey,
    reconcile,
  });

  const hello = useMemo(() => {
    if (!credentials) return null;
    return "hostToken" in credentials
      ? { roomId, role: "host", hostToken: credentials.hostToken }
      : {
          roomId,
          role: "controller",
          controllerId: credentials.controllerId,
          controllerToken: credentials.controllerToken,
        };
  }, [credentials, roomId]);

  const socket = useMultiplayerWakeSocket({
    path: "/api/things/pitch-presentation-ws",
    hello,
    onWake: () => void refresh(),
    onTerminal: () => {
      stoppedRef.current = true;
      setStopped(true);
      setMessage("This presentation session has ended.");
    },
  });

  return { snapshot, setSnapshot, message, refresh, connectionState: socket.state };
}
