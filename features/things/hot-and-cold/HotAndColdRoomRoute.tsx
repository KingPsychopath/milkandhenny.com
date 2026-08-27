import { useEffect, useState } from "react";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { parseHotAndColdInviteFragment } from "./hot-and-cold-invite";
import { HotAndColdRoomApp, JoinHotAndColdRoom } from "./HotAndColdRoomApp";
import type { HotAndColdCredentials } from "./types";

export function HotAndColdRoomRoute({ roomId }: { roomId: string }) {
  const key = hotAndColdBrowserKeys.playerSession(roomId);
  const inviteKey = hotAndColdBrowserKeys.invite(roomId);
  const [credentials, setCredentials] = useState<HotAndColdCredentials | null>();
  const [joinToken, setJoinToken] = useState<string>();
  useEffect(() => {
    setCredentials(readExpiringLocalValue<HotAndColdCredentials>(key));
    setJoinToken(
      parseHotAndColdInviteFragment(consumeLocationFragment()) ||
        readExpiringLocalValue<string>(inviteKey) ||
        "",
    );
  }, [inviteKey, key]);
  useEffect(() => {
    if (credentials) writeExpiringLocalValue(key, credentials, credentials.expiresAt);
  }, [credentials, key]);
  if (credentials === undefined || joinToken === undefined)
    return (
      <div className="hot-and-cold grid min-h-svh place-items-center font-mono text-xs">
        warming the room…
      </div>
    );
  if (!credentials)
    return <JoinHotAndColdRoom roomId={roomId} joinToken={joinToken} onJoined={setCredentials} />;
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
