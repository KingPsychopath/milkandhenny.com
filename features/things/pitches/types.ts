import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ResponsiveImageData } from "@/features/media/image";

export const PITCH_DOCUMENT_SCHEMA_VERSION = 2 as const;
export const PITCH_DEFAULT_MAX_SLIDES = 6;
export const PITCH_SLIDE_LIMIT_RANGE = { min: 1, max: 12 } as const;
export const PITCH_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;
export const PITCH_MAX_ELEMENTS = 1_500;
export const PITCH_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PITCH_AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const PITCH_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
export const PITCH_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const PITCH_PRESENTATION_IMPORT_MAX_BYTES = 30 * 1024 * 1024;
export const PITCH_DECK_ASSET_MAX_BYTES = 300 * 1024 * 1024;
export const PITCH_BACKUP_MAX_BYTES = 450 * 1024 * 1024;
export const PITCH_MEDIA_INPUT_MAX_BYTES = 250 * 1024 * 1024;
export const PITCH_MEDIA_MAX_SECONDS = 120;
export const PITCH_MEDIA_CLIP_LIMIT = 12;
export const PITCH_SLIDE_STAGE = { width: 960, height: 540 } as const;
export const PITCH_SLIDE_DEFAULT_DURATION_MS = 15_000;
export const PITCH_SLIDE_DURATION_RANGE_MS = { min: 5_000, max: 120_000 } as const;
export const PITCH_SHOWCASE_MARKDOWN_HREF = "/things/pitches#showcase" as const;

export const PITCH_OPERATIONAL_MODES = ["enabled", "read-only", "off"] as const;
export type PitchOperationalMode = (typeof PITCH_OPERATIONAL_MODES)[number];

export const PITCH_REMINDER_TEMPLATES = ["resume", "finish", "final"] as const;
export type PitchReminderTemplate = (typeof PITCH_REMINDER_TEMPLATES)[number];

export interface PitchReminderSettings {
  enabled: boolean;
  inactivityDays: number;
  gapDays: number;
  maxAutomatic: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface PitchReminderCandidate {
  id: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
  slideCount: number;
  updatedAt: string;
  automaticCount: number;
  lastSentAt: string | null;
  nextEligibleAt: string;
  automaticEligible: boolean;
}

export interface PitchReminderHistoryItem {
  id: string;
  title: string;
  ownerEmail: string;
  action: "queued" | "failed";
  actor: string;
  template?: PitchReminderTemplate;
  createdAt: string;
}

export interface PitchReminderAdminSnapshot {
  settings: PitchReminderSettings;
  candidates: PitchReminderCandidate[];
  eligibleCount: number;
  nextEligibleAt: string | null;
  recent: PitchReminderHistoryItem[];
}

export interface PitchReminderWaveResult {
  queuedEmails: number;
  sentDecks: number;
  failedDecks: number;
  automatic: boolean;
}

export interface PitchOperationalStatus {
  environmentMode: PitchOperationalMode;
  adminMode: PitchOperationalMode;
  effectiveMode: PitchOperationalMode;
  canRead: boolean;
  canWrite: boolean;
  canPresent: boolean;
  source: "configured" | "environment" | "storage-unavailable" | "invalid-environment";
  message: string;
  updatedAt?: string;
}

export function isPitchOperationalMode(value: unknown): value is PitchOperationalMode {
  return (
    typeof value === "string" && PITCH_OPERATIONAL_MODES.includes(value as PitchOperationalMode)
  );
}

export type PitchDeckLifecycle = "active" | "archived" | "trashed" | "deleting";
export type PitchAssetKind = "image" | "audio" | "video" | "thumbnail";
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

export type PitchMediaKind = "audio" | "video";
export type PitchVideoFit = "contain" | "cover";

export interface PitchVideoPlacement {
  /** Position and size in the fixed 960 × 540 slide coordinate space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Order among video layers. Excalidraw slide objects remain above video. */
  layer: number;
}

export const PITCH_VIDEO_DEFAULT_PLACEMENT: PitchVideoPlacement = {
  x: 80,
  y: 45,
  width: 800,
  height: 450,
  layer: 0,
};

interface PitchMediaClipBase {
  id: string;
  assetId: string;
  /** Position on the slide timeline. */
  timelineStartMs: number;
  /** Source file duration captured by MediaBunny before upload. */
  sourceDurationMs: number;
  /** Trim point inside the source file. */
  sourceStartMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  /** Repeats the trimmed source only when the editor explicitly enables it. */
  loop: boolean;
  locked: boolean;
  /** Linked clips move and trim together until the user unlinks them. */
  linkedGroupId?: string;
}

export interface PitchAudioClip extends PitchMediaClipBase {
  kind: "audio";
  fit?: never;
  videoPlacement?: never;
}

export interface PitchVideoClip extends PitchMediaClipBase {
  kind: "video";
  fit: PitchVideoFit;
  videoPlacement: PitchVideoPlacement;
}

export type PitchMediaClip = PitchAudioClip | PitchVideoClip;

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
  mediaClips: PitchMediaClip[];
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
  thumbnail?: ResponsiveImageData;
}

export type PitchWallStatus = "ok" | "degraded" | "unavailable";

export interface PitchWallLoad {
  status: PitchWallStatus;
  pitches: PublicPitchDeck[];
  rejectedCount: number;
  message?: string;
}

export interface PublicPitchDeckDetail extends PublicPitchDeck {
  document: PitchDocument;
  assets: PitchAsset[];
  editionNumber: number;
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
  currentEditionNumber?: number;
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
  title: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface PitchVersionPreview {
  item: PitchVersionHistoryItem;
  document: PitchDocument;
}

export type PitchCommandKind =
  | "deck.rename"
  | "deck.replace"
  | "slide.add"
  | "slide.remove"
  | "slide.rename"
  | "slide.reorder"
  | "slide.timing"
  | "element.change"
  | "image.add"
  | "ink.add"
  | "media.add"
  | "media.change"
  | "media.remove"
  | "history.restore"
  | "history.undo";

export interface PitchCommandOperation {
  id: string;
  deviceId: string;
  sequence: number;
  kind: PitchCommandKind;
  payload: Record<string, string | number | boolean | null>;
  occurredAt: string;
}

export interface PitchEdition {
  deckId: string;
  editionNumber: number;
  draftVersion: number;
  title: string;
  ownerName: string;
  document: PitchDocument;
  thumbnailAssetId?: string;
  publishedAt: string;
}

export type PitchEditionSummary = Omit<PitchEdition, "document"> & {
  slideCount: number;
  contentCount: number;
};

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
  trashedAt?: string;
  purgeAfter?: string;
}

export interface PitchOwnerCredential {
  deckId: string;
  token: string;
  title: string;
  ownerName: string;
  updatedAt: string;
}

export interface PersonalPitchSummary {
  id: string;
  title: string;
  ownerName: string;
  updatedAt: string;
}

export interface PitchCreatorIdentity {
  name: string;
  email: string;
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
