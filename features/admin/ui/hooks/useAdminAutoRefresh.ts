import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";

export const ADMIN_ACTIVE_REFRESH_WINDOW_MS = 15 * 60_000;

const ADMIN_REFRESH_INTERVALS = {
  active: 12_000,
  monitoring: 30_000,
} as const;

interface AdminAutoRefreshOptions {
  enabled: boolean;
  cadence: keyof typeof ADMIN_REFRESH_INTERVALS;
  identity: string;
  refreshOnEnable?: boolean;
  refresh: (isCurrent: () => boolean) => Promise<void>;
}

/** One bounded policy for admin data that changes without a local action. */
export function useAdminAutoRefresh({
  enabled,
  cadence,
  identity,
  refreshOnEnable = true,
  refresh,
}: AdminAutoRefreshOptions) {
  return useVisibilityReconciler({
    enabled,
    identity,
    intervalMs: ADMIN_REFRESH_INTERVALS[cadence],
    minimumGapMs: 5_000,
    reconcileOnEnable: refreshOnEnable,
    reconcile: refresh,
  });
}
