import type { TransferUploadFileInput } from "./upload-types";

function buildTransferOriginalStorageKey(transferId: string, filename: string): string {
  return `transfers/${transferId}/originals/${filename}`;
}

function buildTransferPrimaryStorageKey(
  transferId: string,
  file: Pick<TransferUploadFileInput, "name" | "convertedFrom">
): string {
  if (file.convertedFrom === "heic") {
    return `transfers/${transferId}/derived/${file.name}`;
  }
  return buildTransferOriginalStorageKey(transferId, file.name);
}

function buildTransferArchivedOriginalStorageKey(
  transferId: string,
  file: Pick<TransferUploadFileInput, "convertedFrom" | "originalName">
): string | undefined {
  if (file.convertedFrom !== "heic" || !file.originalName) return undefined;
  return buildTransferOriginalStorageKey(transferId, file.originalName);
}

export {
  buildTransferArchivedOriginalStorageKey,
  buildTransferOriginalStorageKey,
  buildTransferPrimaryStorageKey,
};
