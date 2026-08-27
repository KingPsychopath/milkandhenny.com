import type { PitchOwnerDeckState } from "../types";

export type PitchSyncState = "saved" | "local" | "syncing" | "merged" | "error";

export interface PitchStudioStatus {
  isDemo: boolean;
  serverSavingPaused: boolean;
  localSaveFailed: boolean;
  mediaSaveFailed: boolean;
  localSaving: boolean;
  syncState: PitchSyncState;
  serverState: PitchOwnerDeckState | "unknown";
  preparingMedia: boolean;
  savingImages: boolean;
  online: boolean;
}

export type PitchStudioStatusTone = "neutral" | "progress" | "success" | "warning" | "error";

export interface PitchStudioStatusSummary {
  label: string;
  tone: PitchStudioStatusTone;
}

/**
 * The one always-visible summary of where this deck's work currently lives.
 *
 * Order is the point: a problem outranks progress, progress outranks a resting
 * state, and "saved" never appears while media or images are still on their way
 * to storage — the slides would be safe but the pictures would not be.
 */
export function pitchStudioStatus(status: PitchStudioStatus): PitchStudioStatusSummary {
  if (status.isDemo) return { label: "demo · not saved", tone: "warning" };
  if (status.localSaveFailed) return { label: "safety copy needs attention", tone: "error" };
  if (status.mediaSaveFailed) return { label: "image save needs attention", tone: "error" };
  if (status.syncState === "error") return { label: "server save needs attention", tone: "error" };
  if (status.serverState === "gone") {
    return { label: "local only · not on server", tone: "warning" };
  }
  if (status.serverState === "trashed") {
    return { label: "in Trash · server saving stopped", tone: "warning" };
  }
  if (status.serverSavingPaused) {
    return { label: "server saving paused · safe here", tone: "warning" };
  }
  if (status.syncState === "merged") return { label: "merged · review changes", tone: "warning" };
  if (status.preparingMedia) return { label: "preparing media…", tone: "progress" };
  if (status.savingImages) return { label: "saving images…", tone: "progress" };
  if (status.localSaving) return { label: "saving safety copy…", tone: "progress" };
  if (status.syncState === "syncing") return { label: "saving to server…", tone: "progress" };
  if (status.syncState === "saved") return { label: "saved to server", tone: "success" };
  return status.online
    ? { label: "safe here · waiting for server", tone: "progress" }
    : { label: "offline · safe on this device", tone: "warning" };
}

export function pitchStudioStatusLabel(status: PitchStudioStatus): string {
  return pitchStudioStatus(status).label;
}
