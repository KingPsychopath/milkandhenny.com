import {
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
} from "./types";

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function createEmptyPitchDocument(): PitchDocument {
  const now = Date.now();
  return {
    schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION,
    slides: [
      {
        id: randomId("s_"),
        name: "Slide 1",
        version: 1,
        updatedAt: now,
        durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
        elements: [],
        assetIds: {},
        mediaClips: [],
      },
    ],
  };
}
