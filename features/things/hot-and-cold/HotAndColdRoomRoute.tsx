import { useCallback, useEffect, useState } from "react";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import {
  readExpiringLocalValue,
  readStorageValue,
  removeStorageKeys,
  writeExpiringLocalValue,
  writeStorageValue,
} from "../shared/game-storage.client";
import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import { parseHotAndColdInviteFragment } from "./hot-and-cold-invite";
import { HotAndColdRoomApp, JoinHotAndColdRoom } from "./HotAndColdRoomApp";
import type { HotAndColdCredentials } from "./types";
import {
  clearUnavailableGamePoolMembership,
  leaveGamePoolRoom,
  useGamePoolRoomBackNavigation,
} from "../pool/pool-session.client";

export function HotAndColdRoomRoute({ roomId }: { roomId: string }) {
  const key = hotAndColdBrowserKeys.playerSession(roomId);
  const inviteKey = hotAndColdBrowserKeys.invite(roomId);
  const [credentials, setCredentials] = useState<HotAndColdCredentials | null>();
  const [joinToken, setJoinToken] = useState<string>();
  useEffect(() => {
    setCredentials(readExpiringLocalValue<HotAndColdCredentials>(key));
    const fragmentToken = parseHotAndColdInviteFragment(consumeLocationFragment());
    if (fragmentToken) writeStorageValue(sessionStorage, inviteKey, fragmentToken);
    const sessionToken = readStorageValue(sessionStorage, inviteKey) ?? "";
    setJoinToken(fragmentToken || sessionToken || readExpiringLocalValue<string>(inviteKey) || "");
  }, [inviteKey, key]);
  useEffect(() => {
    if (credentials) writeExpiringLocalValue(key, credentials, credentials.expiresAt);
  }, [credentials, key]);
  useGamePoolRoomBackNavigation({
    enabled: Boolean(credentials?.snapshot.managed),
    game: "hot-and-cold",
    roomId,
  });
  const clearUnavailableRoom = useCallback(() => {
    removeStorageKeys(localStorage, [key, inviteKey]);
    removeStorageKeys(sessionStorage, [inviteKey]);
    void clearUnavailableGamePoolMembership("hot-and-cold", roomId);
  }, [inviteKey, key, roomId]);
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
      onUnavailable={clearUnavailableRoom}
      onLeave={async () => {
        removeStorageKeys(localStorage, [key]);
        const entrance = await leaveGamePoolRoom("hot-and-cold", roomId);
        window.location.assign(entrance ?? "/things/hot-and-cold");
      }}
    />
  );
}
