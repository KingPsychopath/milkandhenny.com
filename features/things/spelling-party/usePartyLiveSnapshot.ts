import { useCallback, useEffect, useRef, useState } from "react";
import { readPartySnapshotFn } from "./party-room.functions";
import type { PartyRole, PartySnapshot } from "./types";
import { usePartySocket } from "./usePartySocket";

export function usePartyLiveSnapshot(input: {
  roomId: string;
  role: PartyRole;
  credential: string;
  playerId?: string;
  presenterToken?: string;
  initialSnapshot?: PartySnapshot;
}) {
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(input.initialSnapshot ?? null);
  const [clockOffset, setClockOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const inFlight = useRef(false);
  const sequenceRef = useRef(input.initialSnapshot?.sequence ?? 0);
  const refreshRef = useRef<() => void>(() => undefined);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    try {
      const result = await readPartySnapshotFn({
        data: {
          roomId: input.roomId,
          role: input.role,
          credential: input.credential,
          playerId: input.playerId,
          presenterToken: input.presenterToken,
          lastSequence: sequenceRef.current,
        },
      });
      const endedAt = Date.now();
      if (!result.ok || !result.snapshot) {
        setEnded(true);
        setSnapshot(null);
        setMessage(result.error ?? "Room unavailable");
        return;
      }
      sequenceRef.current = result.snapshot.sequence;
      setClockOffset(result.snapshot.serverNow - (startedAt + endedAt) / 2);
      setSnapshot(result.snapshot);
      setEnded(false);
      setMessage(null);
    } catch {
      setMessage("Reconnecting…");
    } finally {
      inFlight.current = false;
    }
  }, [input.credential, input.playerId, input.presenterToken, input.role, input.roomId]);
  useEffect(() => {
    refreshRef.current = () => void refresh();
  }, [refresh]);

  const socket = usePartySocket({
    roomId: ended ? null : input.roomId,
    role: input.role,
    credential: ended ? null : input.credential,
    playerId: input.playerId,
    onWake: () => refreshRef.current(),
  });

  useEffect(() => {
    if (ended) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    const resume = () => void refresh();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ended, refresh]);

  useEffect(() => {
    const round = snapshot?.round;
    if (!round) return;
    const now = Date.now() + clockOffset;
    const boundary = [round.answerOpensAt, round.answerLocksAt, round.revealAt, round.nextRoundAt]
      .filter((time): time is number => time !== null)
      .filter((time) => time > now + 20)
      .sort((a, b) => a - b)[0];
    if (!boundary) return;
    const timer = window.setTimeout(
      () => void refresh(),
      Math.min(2_147_000_000, boundary - now + 60),
    );
    return () => window.clearTimeout(timer);
  }, [clockOffset, refresh, snapshot?.phase, snapshot?.round]);

  return {
    snapshot,
    setSnapshot,
    clockOffset,
    connectionState: socket.state,
    notify: socket.notify,
    refresh,
    ended,
    message,
    setMessage,
  };
}
