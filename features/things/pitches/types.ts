import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const PITCH_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const PITCH_DEFAULT_MAX_SLIDES = 6;
export const PITCH_SLIDE_LIMIT_RANGE = { min: 1, max: 12 } as const;
export const PITCH_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const PITCH_MAX_ELEMENTS = 1_500;
export const PITCH_AUDIO_MAX_SECONDS = 120;
export const PITCH_AUDIO_CUE_LIMIT = 4;
export const PITCH_SLIDE_STAGE = { width: 960, height: 540 } as const;
export const PITCH_SLIDE_DEFAULT_DURATION_MS = 15_000;
export const PITCH_SLIDE_DURATION_RANGE_MS = { min: 5_000, max: 120_000 } as const;
export const PITCH_SHOWCASE_MARKDOWN_HREF = "/things/pitches#showcase" as const;

export type PitchDeckLifecycle = "active" | "archived" | "deleting";
export type PitchAssetKind = "image" | "audio" | "thumbnail" | "import";
export type PitchAssetState = "pending" | "ready";

/** Editor-neutral ink data. Drawesome is one adapter that reads/writes it. */
export interface PitchInkStroke {
  id: number;
  pen: "pencil" | "pen" | "fineliner" | "marker" | "highlighter" | "brush" | "fountain";
  color: string;
  size: number;
  opacity: number;
  points: Array<[number, number, number]>;
  shape?: {
    nibAngle?: number;
    taper?: number;
    simulatePressure?: boolean;
  };
  erase?: boolean;
}

export interface PitchInkLayer {
  id: string;
  name: string;
  board: { w: number; h: number };
  strokes: PitchInkStroke[];
  fileId: string;
  updatedAt: number;
}

export type PitchAudioCueTrigger = "enter" | "exit";
export type PitchAudioCueEnd = "slide-exit" | "clip-end";

export interface PitchAudioCue {
  id: string;
  assetId: string;
  trigger: PitchAudioCueTrigger;
  /** Delay after the trigger. */
  delayMs: number;
  /** The source file duration captured by the browser before upload. */
  sourceDurationMs: number;
  /** Trim from the beginning of the source file. */
  startAtMs: number;
  /** Maximum playback time after the trim point. */
  playForMs: number;
  volume: number;
  /** Whether changing slides stops the cue or lets it finish naturally. */
  end: PitchAudioCueEnd;
}

export interface PitchSlide {
  id: string;
  name: string;
  version: number;
  updatedAt: number;
  durationMs: number;
  deletedAt?: number;
  elements: readonly ExcalidrawElement[];
  /** Excalidraw file id -> durable pitch asset id. */
  assetIds: Record<string, string>;
  audioCues: PitchAudioCue[];
  inkLayers?: PitchInkLayer[];
}

export interface PitchDocument {
  schemaVersion: typeof PITCH_DOCUMENT_SCHEMA_VERSION;
  slides: PitchSlide[];
}

export interface PitchAsset {
  id: string;
  deckId: string;
  fileId?: string;
  kind: PitchAssetKind;
  state: PitchAssetState;
  fileName: string;
  mimeType: string;
  bytes: number;
  createdAt: string;
  readyAt?: string;
  url?: string;
}

export interface PublicPitchDeck {
  id: string;
  title: string;
  ownerName: string;
  publishedAt: string;
  updatedAt: string;
  slideCount: number;
  thumbnailUrl?: string;
}

export interface PublicPitchDeckDetail extends PublicPitchDeck {
  document: PitchDocument;
  assets: PitchAsset[];
}

export interface OwnedPitchDeck {
  id: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
  lifecycle: PitchDeckLifecycle;
  document: PitchDocument;
  version: number;
  publishedVersion?: number;
  publishedAt?: string;
  updatedAt: string;
  draftExpiresAt: string;
  thumbnailAssetId?: string;
  assets: PitchAsset[];
}

export type PitchVersionReason = "autosave" | "safety" | "conflict" | "publish" | "restore";

export interface PitchVersionHistoryItem {
  id: string;
  version: number;
  reason: PitchVersionReason;
  createdAt: string;
  slideCount: number;
  contentCount: number;
}

export interface PitchDeckAdminSummary {
  id: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
  lifecycle: PitchDeckLifecycle;
  slideCount: number;
  publishedSlideCount: number;
  version: number;
  publishedVersion?: number;
  assetCount: number;
  assetBytes: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  draftExpiresAt: string;
}

export interface PitchOwnerCredential {
  deckId: string;
  token: string;
  title: string;
  ownerName: string;
  updatedAt: string;
}

export type PitchSyncResult =
  | {
      ok: true;
      deck: OwnedPitchDeck;
      merged: boolean;
      duplicate: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type PitchPresentationControllerStatus = "pending" | "approved" | "revoked";

export interface PitchPresentationController {
  id: string;
  name: string;
  status: PitchPresentationControllerStatus;
  joinedAt: number;
  lastSeenAt: number;
}

export interface PitchPresentationSnapshot {
  roomId: string;
  eventTitle: string;
  selectedDeckId?: string;
  slideIndex: number;
  revision: number;
  controllers: PitchPresentationController[];
  expiresAt: number;
}

export interface PitchPresentationCredentials {
  roomId: string;
  hostToken: string;
  expiresAt: number;
}

export interface PitchControllerCredentials {
  roomId: string;
  controllerId: string;
  controllerToken: string;
  expiresAt: number;
}
