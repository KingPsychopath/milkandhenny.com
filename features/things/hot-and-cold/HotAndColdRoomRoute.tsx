import { useGameNavigate } from "@/features/things/shared/useGameNavigate";
import { useCallback, useEffect, useState } from "react";
import { RoomLoadingState } from "../shared/RoomLoadingState";
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
import { clearUnavailableGamePoolMembership, leaveGamePoolRoom } from "../pool/pool-session.client";

export function HotAndColdRoomRoute({ roomId }: { roomId: string }) {
  const navigate = useGameNavigate();
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
  const clearUnavailableRoom = useCallback(() => {
    removeStorageKeys(localStorage, [key, inviteKey]);
    removeStorageKeys(sessionStorage, [inviteKey]);
    void clearUnavailableGamePoolMembership("hot-and-cold", roomId);
  }, [inviteKey, key, roomId]);
  if (credentials === undefined || joinToken === undefined)
    return <RoomLoadingState gamePath="/things/hot-and-cold" />;
  if (!credentials)
    return <JoinHotAndColdRoom roomId={roomId} joinToken={joinToken} onJoined={setCredentials} />;
  return (
    <HotAndColdRoomApp
      credentials={credentials}
      onUnavailable={clearUnavailableRoom}
      onLeave={async () => {
        removeStorageKeys(localStorage, [key]);
        const entrance = await leaveGamePoolRoom("hot-and-cold", roomId);
        void navigate({
          to: navigator.onLine ? (entrance ?? "/things/hot-and-cold") : "/things",
          replace: true,
        });
      }}
    />
  );
}
