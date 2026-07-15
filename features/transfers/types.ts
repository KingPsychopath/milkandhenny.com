import type { FileKind } from "@/features/media/file-kinds";
import type {
  PreviewStatus,
  ProcessingBackend,
  ProcessingRoute,
  ProcessingStatus,
} from "./media-state";

type ConvertedFrom = "heic";

type AssetGroupMember = {
  fileId: string;
  role: "primary" | "raw" | "motion";
  mimeType: string;
};

type AssetGroup = {
  id: string;
  type: "live_photo" | "raw_pair";
  capturedAt?: string;
  members: AssetGroupMember[];
};

type TransferFile = {
  id: string;
  filename: string;
  kind: FileKind;
  size: number;
  mimeType: string;
  storageKey: string;
  originalStorageKey?: string;
  originalFilename?: string;
  originalMimeType?: string;
  convertedFrom?: ConvertedFrom;
  previewSource?: "server_raw";
  width?: number;
  height?: number;
  takenAt?: string;
  livePhotoContentId?: string;
  groupId?: string;
  groupRole?: AssetGroupMember["role"];
  previewStatus?: PreviewStatus;
  processingStatus?: ProcessingStatus;
  processingBackend?: ProcessingBackend;
  processingRoute?: ProcessingRoute;
  enqueuedAt?: string;
  processingStartedAt?: string;
  processingCompletedAt?: string;
  processingErrorCode?: string;
  processingErrorDetail?: string;
  retryCount?: number;
};

type TransferData = {
  id: string;
  title: string;
  files: TransferFile[];
  groups?: AssetGroup[];
  createdAt: string;
  expiresAt: string;
  deleteToken: string;
};

type TransferSummary = {
  id: string;
  title: string;
  fileCount: number;
  createdAt: string;
  expiresAt: string;
  remainingSeconds: number;
};

export type {
  AssetGroup,
  AssetGroupMember,
  ConvertedFrom,
  FileKind,
  TransferData,
  TransferFile,
  TransferSummary,
};
