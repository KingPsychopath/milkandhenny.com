import { useCallback, useEffect, useRef, useState } from "react";
import type { MultiplayerConnectionState } from "./multiplayer";
import {
  isMultiplayerServerMessage,
  isTerminalMultiplayerSocketClose,
  MULTIPLAYER_REALTIME_LIMITS,
  MULTIPLAYER_SOCKET_CLOSE,
  type MultiplayerClientControlMessage,
} from "./multiplayer-realtime";

export type MultiplayerWakeSocketState = MultiplayerConnectionState;

interface MultiplayerWakeSocketInput {
  path: string;
  hello: Record<string, string | undefined> | null;
  onWake: () => void;
}

/** Advisory wake-up transport. Durable commands and snapshots remain authoritative over HTTPS. */
export function useMultiplayerWakeSocket(input: MultiplayerWakeSocketInput) {
  const [state, setState] = useState<MultiplayerWakeSocketState>(() =>
    typeof navigator === "undefined" || navigator.onLine ? "reconnecting" : "offline",
  );
  const socketRef = useRef<WebSocket | null>(null);
  const wakeRef = useRef(input.onWake);
  useEffect(() => {
    wakeRef.current = input.onWake;
  }, [input.onWake]);
  const helloJson = input.hello ? JSON.stringify({ type: "hello", ...input.hello }) : "";

  useEffect(() => {
    if (!helloJson) return;
    let active = true;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let heartbeatTimeout: number | null = null;

    const clearTimers = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (heartbeatTimeout !== null) window.clearTimeout(heartbeatTimeout);
      retryTimer = null;
      heartbeatTimer = null;
      heartbeatTimeout = null;
    };
    const send = (target: WebSocket, message: MultiplayerClientControlMessage) => {
      if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify(message));
    };
    const scheduleReconnect = (connect: () => void) => {
      if (!navigator.onLine) {
        setState("offline");
        return;
      }
      setState("reconnecting");
      const delay = Math.min(
        MULTIPLAYER_REALTIME_LIMITS.maxReconnectDelayMs,
        MULTIPLAYER_REALTIME_LIMITS.initialReconnectDelayMs * 2 ** attempt,
      );
      attempt += 1;
      retryTimer = window.setTimeout(connect, delay + Math.random() * 250);
    };

    const connect = () => {
      if (!active || !navigator.onLine) {
        if (active) setState("offline");
        return;
      }
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING)
        return;
      setState("reconnecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(`${protocol}//${location.host}${input.path}`);
      socket = nextSocket;
      socketRef.current = nextSocket;
      nextSocket.onopen = () => {
        nextSocket.send(helloJson);
        heartbeatTimer = window.setInterval(() => {
          if (nextSocket.readyState !== WebSocket.OPEN) return;
          send(nextSocket, { type: "ping" });
          if (heartbeatTimeout !== null) window.clearTimeout(heartbeatTimeout);
          heartbeatTimeout = window.setTimeout(
            () => nextSocket.close(MULTIPLAYER_SOCKET_CLOSE.heartbeatTimeout, "heartbeat timeout"),
            MULTIPLAYER_REALTIME_LIMITS.heartbeatTimeoutMs,
          );
        }, MULTIPLAYER_REALTIME_LIMITS.heartbeatIntervalMs);
      };
      nextSocket.onmessage = (event) => {
        let message: unknown;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!isMultiplayerServerMessage(message)) return;
        if (message.type === "pong" && heartbeatTimeout !== null) {
          window.clearTimeout(heartbeatTimeout);
          heartbeatTimeout = null;
        } else if (message.type === "ready") {
          attempt = 0;
          setState("connected");
          wakeRef.current();
        } else if (message.type === "wake") {
          wakeRef.current();
        }
      };
      nextSocket.onclose = (event) => {
        if (socket === nextSocket) socket = null;
        if (socketRef.current === nextSocket) socketRef.current = null;
        clearTimers();
        if (!active) return;
        if (isTerminalMultiplayerSocketClose(event.code)) {
          setState("offline");
          return;
        }
        scheduleReconnect(connect);
      };
    };

    const resume = () => {
      if (document.visibilityState === "hidden") return;
      connect();
    };
    connect();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      clearTimers();
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      if (socketRef.current === socket) socketRef.current = null;
      socket?.close(MULTIPLAYER_SOCKET_CLOSE.normal, "leaving");
    };
  }, [helloJson, input.path]);

  const notify = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "changed" } satisfies MultiplayerClientControlMessage));
  }, []);
  return { state, notify };
}
