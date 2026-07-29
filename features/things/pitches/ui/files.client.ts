import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

import type { PitchAsset } from "../types";

export function blobToDataUrl(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((response) => response.blob());
}

export async function loadPitchFiles(assets: PitchAsset[]): Promise<BinaryFiles> {
  const files: BinaryFiles = {};
  await Promise.all(
    assets
      .filter((asset) => asset.kind === "image" && asset.fileId && asset.url)
      .map(async (asset) => {
        try {
          const response = await fetch(asset.url!);
          if (!response.ok) return;
          const blob = await response.blob();
          const dataURL = await blobToDataUrl(blob);
          const id = asset.fileId as FileId;
          const file: BinaryFileData = {
            id,
            dataURL,
            mimeType: asset.mimeType as BinaryFileData["mimeType"],
            created: new Date(asset.createdAt).getTime(),
          };
          files[id] = file;
        } catch {
          // A missing signed asset should not stop text and drawings loading.
        }
      }),
  );
  return files;
}
