import { useCallback, useEffect, useRef, useState } from "react";

export type ReliableGameSocketState = "connected" | "reconnecting" | "offline";

/** Shared wake-up transport. Durable commands and snapshots stay on HTTPS. */
export function useReliableGameSocket(input: { path: string; hello: Record<string, string | undefined> | null; onWake: () => void }) {
  const [state, setState] = useState<ReliableGameSocketState>(() => typeof navigator === "undefined" || navigator.onLine ? "reconnecting" : "offline");
  const socketRef = useRef<WebSocket | null>(null);
  const wakeRef = useRef(input.onWake);
  wakeRef.current = input.onWake;
  const helloJson = input.hello ? JSON.stringify({ type: "hello", ...input.hello }) : "";

  useEffect(() => {
    if (!helloJson) return;
    let active = true; let attempt = 0; let retryTimer: number | null = null; let heartbeat: number | null = null;
    const connect = () => {
      if (!active || !navigator.onLine) { setState("offline"); return; }
      setState("reconnecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}${input.path}`);
      socketRef.current = socket;
      socket.onopen = () => socket.send(helloJson);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "ready") { attempt = 0; setState("connected"); wakeRef.current(); }
          if (message.type === "wake") wakeRef.current();
        } catch { /* HTTPS reconciliation is authoritative. */ }
      };
      socket.onclose = () => {
        if (!active) return;
        if (heartbeat !== null) window.clearInterval(heartbeat);
        setState(navigator.onLine ? "reconnecting" : "offline");
        retryTimer = window.setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt) + Math.random() * 250);
        attempt += 1;
      };
      heartbeat = window.setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" })); }, 25_000);
    };
    const resume = () => { if (socketRef.current?.readyState !== WebSocket.OPEN) connect(); };
    connect(); window.addEventListener("online", resume); document.addEventListener("visibilitychange", resume);
    return () => {
      active = false; if (retryTimer !== null) window.clearTimeout(retryTimer); if (heartbeat !== null) window.clearInterval(heartbeat);
      window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", resume); socketRef.current?.close(1000, "leaving");
    };
  }, [helloJson, input.path]);

  const notify = useCallback(() => { if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "changed" })); }, []);
  return { state, notify };
}
