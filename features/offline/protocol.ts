import type { OfflineThingSlug } from "@/features/things/offline";

export type OfflineState =
  | "unavailable"
  | "not-ready"
  | "update-available"
  | "preparing"
  | "ready"
  | "failed";

export type OfflineWorkerRequest =
  | {
      type: "CHECK_THING_OFFLINE";
      slug: OfflineThingSlug;
      buildId: string;
      resourceUrls?: string[];
    }
  | {
      type: "PREPARE_THING_OFFLINE";
      slug: OfflineThingSlug;
      buildId: string;
      resourceUrls: string[];
      refresh?: boolean;
    }
  | {
      type: "REMOVE_THING_OFFLINE";
      slug: OfflineThingSlug;
    };

export interface OfflineWorkerResponse {
  ok: boolean;
  state: Exclude<OfflineState, "unavailable">;
  buildId: string;
  error?: string;
}
