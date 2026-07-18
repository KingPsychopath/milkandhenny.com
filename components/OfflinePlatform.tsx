import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  activateSiteUpdate,
  prepareThingOffline,
  registerOfflinePlatform,
  useSiteUpdateState,
} from "@/features/offline/client";
import { useIsUpdateReloadSafe } from "@/features/offline/update-safety.client";
import { getOfflineThingByPath, type OfflineThingSlug } from "@/features/things/offline";

export function OfflinePlatform() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const updateState = useSiteUpdateState();
  const safeToReload = useIsUpdateReloadSafe();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void registerOfflinePlatform();
    const match = getOfflineThingByPath(pathname);
    if (match) void prepareThingOffline(match[0] as OfflineThingSlug);
  }, [pathname]);

  useEffect(() => {
    if (updateState === "ready" || updateState === "activating" || updateState === "failed") {
      setDismissed(false);
    }
    if (updateState !== "updated") return;
    setDismissed(false);
    const timeout = window.setTimeout(() => setDismissed(true), 2_400);
    return () => window.clearTimeout(timeout);
  }, [updateState]);

  if (updateState === "idle" || dismissed) return null;

  const activating = updateState === "activating";
  const updated = updateState === "updated";
  const failed = updateState === "failed";
  const message = activating
    ? "updating…"
    : updated
      ? "you’re up to date"
      : failed
        ? "update paused"
        : safeToReload
          ? "update ready"
          : "update ready after this round";

  return (
    <aside className="fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border theme-border bg-background/95 py-1 pl-4 pr-1 text-foreground shadow-md backdrop-blur-sm">
      {activating ? (
        <span
          aria-hidden="true"
          className="mr-1 size-3 shrink-0 animate-spin rounded-full border border-current/20 border-t-current motion-reduce:animate-none"
        />
      ) : null}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="whitespace-nowrap font-mono text-xs theme-muted"
      >
        {message}
      </p>
      {safeToReload && !activating && !updated ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-11 px-2 font-mono text-xs opacity-55 transition-opacity hover:opacity-100"
          >
            later
          </button>
          <button
            type="button"
            onClick={() => void activateSiteUpdate()}
            className="min-h-11 rounded-full px-3 font-mono text-xs font-bold transition-opacity hover:opacity-60"
          >
            {failed ? "try again" : "update"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
