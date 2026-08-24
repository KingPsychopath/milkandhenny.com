import { useEffect, useState } from "react";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { HotAndColdRoomApp, JoinHotAndColdRoom } from "./HotAndColdRoomApp";
import type { HotAndColdCredentials } from "./types";

export function HotAndColdRoomRoute({ roomId }: { roomId: string }) {
  const key = hotAndColdBrowserKeys.playerSession(roomId);
  const [credentials, setCredentials] = useState<HotAndColdCredentials | null>();
  useEffect(() => {
    setCredentials(readExpiringLocalValue<HotAndColdCredentials>(key));
  }, [key]);
  useEffect(() => {
    if (credentials) writeExpiringLocalValue(key, credentials, credentials.expiresAt);
  }, [credentials, key]);
  if (credentials === undefined)
    return (
      <div className="hot-and-cold grid min-h-svh place-items-center font-mono text-xs">
        warming the room…
      </div>
    );
  if (!credentials) return <JoinHotAndColdRoom roomId={roomId} onJoined={setCredentials} />;
  return (
    <HotAndColdRoomApp
      credentials={credentials}
      onLeave={() => {
        localStorage.removeItem(key);
        setCredentials(null);
      }}
    />
  );
}
