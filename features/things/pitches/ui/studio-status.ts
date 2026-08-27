import type { PitchOwnerDeckState } from "../types";

export type PitchSyncState = "saved" | "local" | "syncing" | "merged" | "error";

export interface PitchStudioStatus {
  isDemo: boolean;
  serverSavingPaused: boolean;
  localSaveFailed: boolean;
  syncState: PitchSyncState;
  serverState: PitchOwnerDeckState | "unknown";
  preparingMedia: boolean;
  savingImages: boolean;
  online: boolean;
}

/**
 * The one always-visible summary of where this deck's work currently lives.
 *
 * Order is the point: a problem outranks progress, progress outranks a resting
 * state, and "saved" never appears while media or images are still on their way
 * to storage — the slides would be safe but the pictures would not be.
 */
export function pitchStudioStatusLabel(status: PitchStudioStatus): string {
  if (status.isDemo) return "demo · not saved";
  if (status.serverSavingPaused) return "server saving paused · safe here";
  if (status.localSaveFailed) return "local backup needs attention";
  if (status.syncState === "error") return "needs attention";
  if (status.syncState === "merged") return "recovered + merged";
  if (status.preparingMedia) return "preparing media…";
  if (status.savingImages) return "saving images…";
  if (status.syncState === "syncing") return "syncing…";
  if (status.serverState === "gone") return "local only · not on the server";
  if (status.serverState === "trashed") return "in trash · not saving";
  if (status.syncState === "saved") return "saved";
  return status.online ? "saved on this device" : "offline · safe here";
}
