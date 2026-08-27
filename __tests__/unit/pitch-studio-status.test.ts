import { expect, it } from "vitest";

import {
  pitchStudioStatusLabel,
  type PitchStudioStatus,
} from "@/features/things/pitches/ui/studio-status";

function status(overrides: Partial<PitchStudioStatus> = {}): PitchStudioStatus {
  return {
    isDemo: false,
    serverSavingPaused: false,
    localSaveFailed: false,
    syncState: "saved",
    serverState: "active",
    preparingMedia: false,
    savingImages: false,
    online: true,
    ...overrides,
  };
}

it("never reports a deck as saved while its media is still on the way", () => {
  expect(pitchStudioStatusLabel(status({ preparingMedia: true }))).toBe("preparing media…");
  expect(pitchStudioStatusLabel(status({ savingImages: true }))).toBe("saving images…");
  expect(pitchStudioStatusLabel(status())).toBe("saved");
});

it("puts a problem ahead of progress", () => {
  expect(pitchStudioStatusLabel(status({ syncState: "error", preparingMedia: true }))).toBe(
    "needs attention",
  );
  expect(pitchStudioStatusLabel(status({ localSaveFailed: true, syncState: "syncing" }))).toBe(
    "local backup needs attention",
  );
  expect(pitchStudioStatusLabel(status({ serverSavingPaused: true, savingImages: true }))).toBe(
    "server saving paused · safe here",
  );
});

it("says where a deck stands when the server has no editable copy", () => {
  expect(pitchStudioStatusLabel(status({ serverState: "gone", syncState: "local" }))).toBe(
    "local only · not on the server",
  );
  expect(pitchStudioStatusLabel(status({ serverState: "trashed", syncState: "local" }))).toBe(
    "in trash · not saving",
  );
});

it("distinguishes an unsaved local copy from an offline one", () => {
  expect(pitchStudioStatusLabel(status({ syncState: "local" }))).toBe("saved on this device");
  expect(pitchStudioStatusLabel(status({ syncState: "local", online: false }))).toBe(
    "offline · safe here",
  );
  expect(pitchStudioStatusLabel(status({ isDemo: true, syncState: "local" }))).toBe(
    "demo · not saved",
  );
});
