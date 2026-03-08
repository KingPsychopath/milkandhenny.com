import { classifyTransferProcessingRoute, getExpectedTransferAssetKeys } from "./media-state";
import type { ProcessingRoute } from "./media-state";
import type { TransferFile } from "./store";

function getTransferFileDeleteKeys(
  transferId: string,
  file: Pick<TransferFile, "id" | "filename" | "storageKey" | "originalStorageKey" | "processingRoute">
): string[] {
  const route: ProcessingRoute | null =
    file.processingRoute ?? classifyTransferProcessingRoute(file.filename);
  const expected = route
    ? getExpectedTransferAssetKeys(transferId, file.filename, route, file.id)
    : {};

  return Array.from(
    new Set(
      [
        file.storageKey,
        file.originalStorageKey,
        expected.thumbKey,
        expected.fullKey,
      ].filter((key): key is string => typeof key === "string" && key.length > 0)
    )
  );
}

function resolveTransferFileForDelete<
  T extends Pick<TransferFile, "id" | "filename">
>(files: readonly T[], selector: string): T | null {
  const exactId = files.find((file) => file.id === selector);
  if (exactId) return exactId;

  const exactFilename = files.filter((file) => file.filename === selector);
  if (exactFilename.length === 1) return exactFilename[0];
  if (exactFilename.length > 1) {
    throw new Error(
      `Multiple files match filename "${selector}". Use the file id instead.`
    );
  }

  return null;
}

export { getTransferFileDeleteKeys, resolveTransferFileForDelete };
