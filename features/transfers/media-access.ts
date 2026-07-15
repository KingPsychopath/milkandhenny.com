import type { TransferData } from "./types";

type TransferMediaVariant = "primary" | "original" | "thumb" | "full";

type TransferMediaTarget = {
  key: string;
  filename: string;
  contentType: string;
};

function resolveTransferMediaTarget(
  transfer: TransferData,
  fileId: string,
  variant: TransferMediaVariant,
): TransferMediaTarget | null {
  const file = transfer.files.find((candidate) => candidate.id === fileId);
  if (!file) return null;

  if (variant === "primary") {
    return { key: file.storageKey, filename: file.filename, contentType: file.mimeType };
  }

  if (variant === "original") {
    return {
      key: file.originalStorageKey ?? file.storageKey,
      filename: file.originalFilename ?? file.filename,
      contentType: file.originalMimeType ?? file.mimeType,
    };
  }

  if (file.previewStatus !== "ready") return null;

  return {
    key: `transfers/${transfer.id}/${variant}/${file.id}.webp`,
    filename: `${file.id}.webp`,
    contentType: "image/webp",
  };
}

function isTransferMediaVariant(value: string): value is TransferMediaVariant {
  return value === "primary" || value === "original" || value === "thumb" || value === "full";
}

function transferContainsStorageKey(transfer: TransferData, key: string): boolean {
  if (!key.startsWith(`transfers/${transfer.id}/`)) return false;

  return transfer.files.some((file) => {
    if (key === file.storageKey || key === file.originalStorageKey) return true;
    if (file.previewStatus !== "ready") return false;
    return (
      key === `transfers/${transfer.id}/thumb/${file.id}.webp` ||
      key === `transfers/${transfer.id}/full/${file.id}.webp`
    );
  });
}

export { isTransferMediaVariant, resolveTransferMediaTarget, transferContainsStorageKey };
export type { TransferMediaTarget, TransferMediaVariant };
