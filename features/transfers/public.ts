import type { TransferData, TransferFile } from "./types";

type PublicTransferFile = Omit<
  TransferFile,
  "storageKey" | "originalStorageKey" | "processingErrorDetail" | "storedBytes"
>;
type PublicTransfer = Omit<TransferData, "deleteToken" | "ownerPersonId" | "files"> & {
  files: PublicTransferFile[];
};

function toPublicTransferFile(file: TransferFile): PublicTransferFile {
  const {
    storageKey: _storageKey,
    originalStorageKey: _originalStorageKey,
    processingErrorDetail: _processingErrorDetail,
    storedBytes: _storedBytes,
    ...publicFile
  } = file;
  return publicFile;
}

function toPublicTransfer(transfer: TransferData): PublicTransfer {
  const {
    deleteToken: _deleteToken,
    ownerPersonId: _ownerPersonId,
    files,
    ...publicTransfer
  } = transfer;
  return {
    ...publicTransfer,
    files: files.map(toPublicTransferFile),
  };
}

export { toPublicTransfer, toPublicTransferFile };
export type { PublicTransfer, PublicTransferFile };
