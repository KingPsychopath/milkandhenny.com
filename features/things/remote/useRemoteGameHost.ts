import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeRemoteRoomFn,
  createRemoteRoomFn,
  syncRemoteHostFn,
} from "./remote-room.functions";
import type {
  RemoteCommand,
  RemoteGameKind,
  RemoteGameSnapshot,
  RemoteRoomCredentials,
} from "./types";

const SYNC_INTERVAL_MS = 850;

function storageKey(game: RemoteGameKind) {
  return `thing-remote-host:${game}`;
}

export function useRemoteGameHost(
  game: RemoteGameKind,
  snapshot: RemoteGameSnapshot,
  onCommand: (command: RemoteCommand) => void,
) {
  const [room, setRoom] = useState<RemoteRoomCredentials | null>(null);
  const [judgeConnected, setJudgeConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const commandRef = useRef(onCommand);
  const acknowledgeRef = useRef(0);
  const processedCommands = useRef(new Set<string>());
  snapshotRef.current = snapshot;
  commandRef.current = onCommand;

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(game)) ?? "null");
      if (!stored || typeof stored !== "object") return;
      const value = stored as Partial<RemoteRoomCredentials>;
      if (
        typeof value.roomId === "string" &&
        typeof value.hostToken === "string" &&
        typeof value.judgeToken === "string" &&
        typeof value.expiresAt === "number" &&
        value.expiresAt > Date.now()
      ) {
        setRoom(value as RemoteRoomCredentials);
      }
    } catch {
      sessionStorage.removeItem(storageKey(game));
    }
  }, [game]);

  useEffect(() => {
    if (!room) return;
    sessionStorage.setItem(storageKey(game), JSON.stringify(room));
  }, [game, room]);

  const createRoom = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const credentials = await createRemoteRoomFn({ data: { game } });
      setRoom(credentials);
      setMessage("Invite ready.");
      return credentials;
    } catch {
      setMessage("Could not start remote judging. Local play still works.");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [game]);

  const closeRoom = useCallback(async () => {
    const current = room;
    setRoom(null);
    setJudgeConnected(false);
    acknowledgeRef.current = 0;
    processedCommands.current.clear();
    sessionStorage.removeItem(storageKey(game));
    if (current) {
      try {
        await closeRemoteRoomFn({
          data: { roomId: current.roomId, hostToken: current.hostToken },
        });
      } catch {
        // The room expires automatically.
      }
    }
  }, [game, room]);

  useEffect(() => {
    if (!room) return;
    let active = true;
    let inFlight = false;

    const sync = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const acknowledge = acknowledgeRef.current;
        const result = await syncRemoteHostFn({
          data: {
            roomId: room.roomId,
            hostToken: room.hostToken,
            snapshot: snapshotRef.current,
            acknowledge,
          },
        });
        if (!active) return;
        if (!result.ok) {
          setMessage(result.error ?? "Remote room ended. Local play continues.");
          setRoom(null);
          setJudgeConnected(false);
          sessionStorage.removeItem(storageKey(game));
          return;
        }
        if (acknowledge > 0) acknowledgeRef.current = 0;
        setJudgeConnected(result.judgeConnected);
        let received = 0;
        for (const command of result.commands) {
          received += 1;
          if (processedCommands.current.has(command.id)) continue;
          processedCommands.current.add(command.id);
          commandRef.current(command);
        }
        acknowledgeRef.current = received;
      } catch {
        if (active) setJudgeConnected(false);
      } finally {
        inFlight = false;
      }
    };

    void sync();
    const interval = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [game, room]);

  const inviteUrl =
    room && typeof window !== "undefined"
      ? `${window.location.origin}/things/judge/${room.roomId}#${room.judgeToken}`
      : null;

  return {
    room,
    inviteUrl,
    judgeConnected,
    syncing,
    message,
    createRoom,
    closeRoom,
    setMessage,
  };
}
