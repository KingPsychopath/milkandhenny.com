import type { TransferData, TransferFile } from "./types";

type PublicTransferFile = Omit<TransferFile, "storageKey" | "originalStorageKey">;
type PublicTransfer = Omit<TransferData, "deleteToken" | "files"> & {
  files: PublicTransferFile[];
};

function toPublicTransferFile(file: TransferFile): PublicTransferFile {
  const { storageKey: _storageKey, originalStorageKey: _originalStorageKey, ...publicFile } = file;
  return publicFile;
}

function toPublicTransfer(transfer: TransferData): PublicTransfer {
  const { deleteToken: _deleteToken, files, ...publicTransfer } = transfer;
  return {
    ...publicTransfer,
    files: files.map(toPublicTransferFile),
  };
}

export { toPublicTransfer, toPublicTransferFile };
export type { PublicTransfer, PublicTransferFile };
