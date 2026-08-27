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
    mediaSaveFailed: false,
    localSaving: false,
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
  expect(pitchStudioStatusLabel(status())).toBe("saved to server");
});

it("puts a problem ahead of progress", () => {
  expect(pitchStudioStatusLabel(status({ syncState: "error", preparingMedia: true }))).toBe(
    "server save needs attention",
  );
  expect(pitchStudioStatusLabel(status({ localSaveFailed: true, syncState: "syncing" }))).toBe(
    "safety copy needs attention",
  );
  expect(pitchStudioStatusLabel(status({ localSaveFailed: true, serverSavingPaused: true }))).toBe(
    "safety copy needs attention",
  );
  expect(pitchStudioStatusLabel(status({ mediaSaveFailed: true }))).toBe(
    "image save needs attention",
  );
  expect(pitchStudioStatusLabel(status({ serverSavingPaused: true, savingImages: true }))).toBe(
    "server saving paused · safe here",
  );
});

it("says where a deck stands when the server has no editable copy", () => {
  expect(pitchStudioStatusLabel(status({ serverState: "gone", syncState: "local" }))).toBe(
    "local only · not on server",
  );
  expect(pitchStudioStatusLabel(status({ serverState: "trashed", syncState: "local" }))).toBe(
    "in Trash · server saving stopped",
  );
});

it("distinguishes an unsaved local copy from an offline one", () => {
  expect(pitchStudioStatusLabel(status({ syncState: "local" }))).toBe(
    "safe here · waiting for server",
  );
  expect(pitchStudioStatusLabel(status({ syncState: "local", online: false }))).toBe(
    "offline · safe on this device",
  );
  expect(pitchStudioStatusLabel(status({ isDemo: true, syncState: "local" }))).toBe(
    "demo · not saved",
  );
});

it("does not claim the browser copy is safe before its write finishes", () => {
  expect(pitchStudioStatusLabel(status({ syncState: "local", localSaving: true }))).toBe(
    "saving safety copy…",
  );
});
