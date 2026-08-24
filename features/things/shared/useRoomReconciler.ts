import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";
import { MULTIPLAYER_REALTIME_LIMITS } from "./multiplayer-realtime";

interface RoomReconcilerOptions {
  enabled: boolean;
  intervalMs: number;
  roomKey: string | null;
  reconcile: (isCurrent: () => boolean) => Promise<void>;
}

/** Coalesces socket wakes, safety polling, online events, and tab resumes into one request. */
export function useRoomReconciler({
  enabled,
  intervalMs,
  roomKey,
  reconcile,
}: RoomReconcilerOptions) {
  return useVisibilityReconciler({
    enabled,
    intervalMs,
    identity: roomKey,
    minimumGapMs: MULTIPLAYER_REALTIME_LIMITS.minimumReconciliationGapMs,
    reconcile,
  });
}
