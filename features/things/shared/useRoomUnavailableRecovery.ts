import { useCallback, useEffect, useRef, useState } from "react";

export function useRoomUnavailableRecovery({
  roomKey,
  unavailable,
  onUnavailable,
}: {
  roomKey: string;
  unavailable: boolean;
  onUnavailable?: () => void;
}) {
  const [actionUnavailableRoom, setActionUnavailableRoom] = useState<string | null>(null);
  const handledRoom = useRef<string | null>(null);
  const markUnavailable = useCallback(() => setActionUnavailableRoom(roomKey), [roomKey]);
  const roomUnavailable = unavailable || actionUnavailableRoom === roomKey;

  useEffect(() => {
    if (!roomUnavailable || handledRoom.current === roomKey) return;
    handledRoom.current = roomKey;
    onUnavailable?.();
  }, [onUnavailable, roomKey, roomUnavailable]);

  return { roomUnavailable, markUnavailable };
}
