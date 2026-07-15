import { useCallback, useEffect, useRef, useState } from "react";
import { closeRemoteRoomFn, createRemoteRoomFn, syncRemotePlayerFn } from "./remote-room.functions";
import type {
  RemoteCommand,
  RemoteCommandReceipt,
  RemoteGameKind,
  RemoteGameSetup,
  RemoteGameSnapshot,
  RemotePlayerSession,
  RemoteRoomCredentials,
  RemoteSyncedSnapshot,
} from "./types";
import { useRemoteSocket } from "./useRemoteSocket";

const SAFETY_SYNC_INTERVAL_MS = 12_000;

interface PlayerRoom {
  roomId: string;
  playerToken: string;
  connectionEpoch: string;
  judgeToken?: string;
  expiresAt: number;
}

function storageKey(game: RemoteGameKind) {
  return `thing-remote-player:v2:${game}`;
}

function playerRoom(value: RemoteRoomCredentials | RemotePlayerSession): PlayerRoom {
  return {
    roomId: value.roomId,
    playerToken: value.playerToken,
    connectionEpoch: "connectionEpoch" in value ? value.connectionEpoch : crypto.randomUUID(),
    judgeToken: "judgeToken" in value ? value.judgeToken : undefined,
    expiresAt: value.expiresAt,
  };
}

export function useRemotePlayerRoom(
  game: RemoteGameKind,
  setup: RemoteGameSetup,
  snapshot: RemoteGameSnapshot,
  onCommand: (command: RemoteCommand) => void,
  initialSession?: RemotePlayerSession,
) {
  const [room, setRoom] = useState<PlayerRoom | null>(() => initialSession ? playerRoom(initialSession) : null);
  const [judgeConnected, setJudgeConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const commandRef = useRef(onCommand);
  const lastCommandSequenceRef = useRef(0);
  const processedCommands = useRef(new Set<string>());
  const decidedItemsRef = useRef(new Set<string>());
  const receiptsRef = useRef<RemoteCommandReceipt[]>([]);
  const connectionEpochRef = useRef(room?.connectionEpoch ?? crypto.randomUUID());
  const roundIdRef = useRef<string | null>(null);
  const lastRevisionSignatureRef = useRef("");
  const revisionRef = useRef(0);
  const syncNowRef = useRef<(() => void) | null>(null);
  snapshotRef.current = snapshot;
  commandRef.current = onCommand;

  const syncedSnapshot = useCallback((): RemoteSyncedSnapshot => {
    const current = snapshotRef.current;
    if (current.phase === "setup") roundIdRef.current = null;
    else if (!roundIdRef.current) roundIdRef.current = crypto.randomUUID();
    const itemId = current.phase === "playing" && current.itemKey && roundIdRef.current
      ? `${roundIdRef.current}:${current.itemKey}`
      : null;
    const signature = JSON.stringify({
      ...current,
      updatedAt: 0,
      roundId: roundIdRef.current,
      itemId,
      commandReceipts: receiptsRef.current,
    });
    if (signature !== lastRevisionSignatureRef.current) {
      lastRevisionSignatureRef.current = signature;
      revisionRef.current += 1;
    }
    return {
      ...current,
      roundId: roundIdRef.current,
      itemId,
      revision: revisionRef.current,
      connectionEpoch: connectionEpochRef.current,
      commandReceipts: receiptsRef.current,
    };
  }, []);

  const { state: transportState, notify: notifySocket } = useRemoteSocket({
    roomId: room?.roomId ?? null,
    role: "player",
    token: room?.playerToken ?? null,
    onWake: () => syncNowRef.current?.(),
  });

  useEffect(() => {
    if (initialSession) return;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey(game)) ?? "null");
      if (!stored || typeof stored !== "object") return;
      const value = stored as Partial<PlayerRoom>;
      if (typeof value.roomId === "string" && typeof value.playerToken === "string" && typeof value.expiresAt === "number" && value.expiresAt > Date.now()) {
        if (typeof value.connectionEpoch !== "string") value.connectionEpoch = crypto.randomUUID();
        setRoom(value as PlayerRoom);
      }
    } catch {
      sessionStorage.removeItem(storageKey(game));
    }
  }, [game, initialSession]);

  useEffect(() => {
    if (!room || initialSession) return;
    connectionEpochRef.current = room.connectionEpoch;
    sessionStorage.setItem(storageKey(game), JSON.stringify(room));
  }, [game, initialSession, room]);

  const createRoom = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const credentials = await createRemoteRoomFn({ data: { creatorRole: "player", setup } });
      setRoom(playerRoom(credentials));
      setMessage("Judge invite ready.");
      return credentials;
    } catch {
      setMessage("Could not start remote judging. You can still play normally.");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [setup]);

  const createJudgeRoom = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const credentials = await createRemoteRoomFn({ data: { creatorRole: "judge", setup } });
      const hash = new URLSearchParams({ judge: credentials.judgeToken, player: credentials.playerToken, game });
      window.location.assign(`/things/judge/${credentials.roomId}#${hash.toString()}`);
      return credentials;
    } catch {
      setMessage("Could not make the player invite. Check your connection and try again.");
      return null;
    } finally {
      setSyncing(false);
    }
  }, [game, setup]);

  const closeRoom = useCallback(async () => {
    const current = room;
    setRoom(null);
    setJudgeConnected(false);
    lastCommandSequenceRef.current = 0;
    processedCommands.current.clear();
    decidedItemsRef.current.clear();
    receiptsRef.current = [];
    if (!initialSession) sessionStorage.removeItem(storageKey(game));
    if (!current) return;
    try {
      await closeRemoteRoomFn({ data: { roomId: current.roomId, role: "player", token: current.playerToken } });
    } catch {
      // Rooms expire automatically; local play must not depend on cleanup.
    }
  }, [game, initialSession, room]);

  useEffect(() => {
    if (!room) return;
    let active = true;
    let inFlight = false;

    const sync = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const currentSnapshot = syncedSnapshot();
        const result = await syncRemotePlayerFn({
          data: {
            roomId: room.roomId,
            playerToken: room.playerToken,
            snapshot: currentSnapshot,
            lastCommandSequence: lastCommandSequenceRef.current,
          },
        });
        if (!active) return;
        if (!result.ok) {
          setMessage(result.error ?? "Remote room ended. Local play continues.");
          setRoom(null);
          setJudgeConnected(false);
          if (!initialSession) sessionStorage.removeItem(storageKey(game));
          return;
        }
        setJudgeConnected(result.judgeConnected);
        let received = false;
        for (const command of result.commands) {
          lastCommandSequenceRef.current = Math.max(lastCommandSequenceRef.current, command.sequence);
          if (processedCommands.current.has(command.id)) continue;
          processedCommands.current.add(command.id);
          const latest = syncedSnapshot();
          const isDecision = command.type === "correct" || command.type === "incorrect" || command.type === "pass";
          let receipt: RemoteCommandReceipt;
          if (latest.roundId !== command.roundId) {
            receipt = { commandId: command.id, sequence: command.sequence, status: "rejected", reason: "stale round" };
          } else if (latest.itemId !== command.itemId || (isDecision && (latest.transitioning || decidedItemsRef.current.has(command.itemId)))) {
            receipt = { commandId: command.id, sequence: command.sequence, status: "rejected", reason: "stale item" };
          } else {
            commandRef.current(command);
            if (isDecision) decidedItemsRef.current.add(command.itemId);
            receipt = { commandId: command.id, sequence: command.sequence, status: "applied" };
          }
          receiptsRef.current = [...receiptsRef.current.filter(({ commandId }) => commandId !== command.id), receipt].slice(-20);
          received = true;
        }
        if (processedCommands.current.size > 500) {
          processedCommands.current = new Set([...processedCommands.current].slice(-250));
        }
        notifySocket();
        if (received) window.setTimeout(() => syncNowRef.current?.(), 0);
      } catch {
        if (active) {
          setJudgeConnected(false);
          setMessage("Judge reconnecting. Your game keeps working.");
        }
      } finally {
        inFlight = false;
      }
    };

    const handleResume = () => void sync();
    syncNowRef.current = () => void sync();
    void sync();
    const interval = window.setInterval(() => void sync(), SAFETY_SYNC_INTERVAL_MS);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => {
      active = false;
      syncNowRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [game, initialSession, notifySocket, room, syncedSnapshot]);

  const snapshotSignature = JSON.stringify({ ...snapshot, updatedAt: 0 });
  useEffect(() => {
    if (room) syncNowRef.current?.();
  }, [room, snapshotSignature]);

  const inviteUrl = room?.judgeToken && typeof window !== "undefined"
    ? `${window.location.origin}/things/judge/${room.roomId}#${room.judgeToken}`
    : null;

  return {
    room,
    inviteUrl,
    judgeConnected,
    transportState,
    syncing,
    message,
    createRoom,
    createJudgeRoom,
    closeRoom,
    setMessage,
  };
}
