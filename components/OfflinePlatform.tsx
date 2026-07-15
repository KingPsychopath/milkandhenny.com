import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { activateSiteUpdate, prepareThingOffline, registerOfflinePlatform, useSiteUpdateState } from "@/features/offline/client";
import { useIsUpdateReloadSafe } from "@/features/offline/update-safety.client";
import { getOfflineThingByPath, type OfflineThingSlug } from "@/features/things/offline";

export function OfflinePlatform() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const updateState = useSiteUpdateState();
  const safeToReload = useIsUpdateReloadSafe();

  useEffect(() => {
    void registerOfflinePlatform();
    const match = getOfflineThingByPath(pathname);
    if (match) void prepareThingOffline(match[0] as OfflineThingSlug);
  }, [pathname]);

  if (updateState === "idle") return null;

  return (
    <aside aria-live="polite" className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-lg items-center justify-between gap-4 rounded-2xl border border-black/15 bg-[#f3ecdf] px-4 py-3 text-black shadow-xl">
      <p className="font-mono text-xs leading-relaxed">
        {safeToReload ? "A newer version is ready." : "A newer version is ready after this round."}
      </p>
      {safeToReload ? (
        <button type="button" onClick={() => void activateSiteUpdate()} disabled={updateState === "activating"} className="min-h-11 shrink-0 font-mono text-xs font-bold underline underline-offset-4 disabled:opacity-50">
          {updateState === "activating" ? "updating…" : "update now"}
        </button>
      ) : null}
    </aside>
  );
}
