import type { OfflineThingSlug } from "@/features/things/offline";

export type OfflineState = "unavailable" | "not-ready" | "preparing" | "ready" | "failed";

export type OfflineWorkerRequest =
  | {
      type: "CHECK_THING_OFFLINE";
      slug: OfflineThingSlug;
      buildId: string;
    }
  | {
      type: "PREPARE_THING_OFFLINE";
      slug: OfflineThingSlug;
      buildId: string;
      resourceUrls: string[];
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
