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
    if (updateState === "activating" || updateState === "failed") setDismissed(false);
  }, [updateState]);

  if (updateState === "idle" || dismissed) return null;

  const activating = updateState === "activating";
  const failed = updateState === "failed";
  const title = activating ? "Updating…" : failed ? "Couldn’t update" : "Update ready";
  const detail = activating
    ? "This page will refresh when it’s ready."
    : failed
      ? "Your current version still works."
      : safeToReload
        ? "A quick refresh gets the latest version."
        : "Available after this round.";

  return (
    <aside
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-lg items-center justify-between gap-4 rounded-2xl border border-black/15 bg-[var(--things-cream)] px-4 py-3 text-black shadow-xl"
    >
      <div className="min-w-0">
        <p className="font-mono text-xs font-bold">{title}</p>
        <p className="mt-0.5 font-mono text-micro leading-relaxed text-black/60">{detail}</p>
      </div>
      {safeToReload ? (
        <div className="flex shrink-0 items-center gap-1">
          {!activating ? (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="min-h-11 px-2 font-mono text-xs text-black/55 underline underline-offset-4"
            >
              later
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void activateSiteUpdate()}
            disabled={activating}
            className="inline-flex min-h-11 items-center gap-2 px-2 font-mono text-xs font-bold underline underline-offset-4 disabled:no-underline"
          >
            {activating ? (
              <span
                aria-hidden="true"
                className="size-3 animate-spin rounded-full border border-black/25 border-t-black motion-reduce:animate-none"
              />
            ) : null}
            {activating ? "updating…" : failed ? "try again" : "update"}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
