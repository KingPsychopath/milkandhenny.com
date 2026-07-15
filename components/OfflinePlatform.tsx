import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { prepareThingOffline, registerOfflinePlatform } from "@/features/offline/client";
import { getOfflineThingByPath, type OfflineThingSlug } from "@/features/things/offline";

export function OfflinePlatform() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    void registerOfflinePlatform();
    const match = getOfflineThingByPath(pathname);
    if (match) void prepareThingOffline(match[0] as OfflineThingSlug);
  }, [pathname]);

  return null;
}
