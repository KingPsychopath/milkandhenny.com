import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

import { fetchWithRetry } from "@/lib/http/fetch-with-retry";
import type { PitchAsset } from "../types";

export function blobToDataUrl(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as DataURL);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

function percentDecodedBytes(payload: string): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let byteLength = 0;
  let literalStart = 0;

  const appendLiteral = (end: number) => {
    if (end <= literalStart) return;
    const chunk = encoder.encode(payload.slice(literalStart, end));
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  };

  for (let index = 0; index < payload.length; index++) {
    const encoded = payload.slice(index + 1, index + 3);
    if (payload[index] !== "%" || !/^[\da-f]{2}$/i.test(encoded)) continue;
    appendLiteral(index);
    chunks.push(Uint8Array.of(Number.parseInt(encoded, 16)));
    byteLength++;
    index += 2;
    literalStart = index + 1;
  }
  appendLiteral(payload.length);
  const decoded = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    decoded.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoded;
}

/**
 * Decode a data URL in place rather than through `fetch`.
 *
 * `fetch("data:…")` is checked against CSP `connect-src`, which lists network
 * origins only — so the browser blocks it and reports a bare "Failed to fetch"
 * with no clue that a policy was involved. The payload is already in memory;
 * reading it here keeps canvas images off the network stack entirely.
 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const separator = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || separator === -1) {
    throw new Error("That image is not stored in a readable form");
  }
  const header = dataUrl.slice("data:".length, separator);
  const isBase64 = /;base64$/i.test(header);
  const mediaType = isBase64 ? header.slice(0, -";base64".length) : header;
  const mimeType = mediaType
    ? mediaType.startsWith(";")
      ? `text/plain${mediaType}`
      : mediaType
    : "text/plain;charset=US-ASCII";
  const payload = dataUrl.slice(separator + 1);
  try {
    const decoded = percentDecodedBytes(payload);
    if (!isBase64) return new Blob([decoded], { type: mimeType });

    const binary = atob(new TextDecoder("iso-8859-1").decode(decoded));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  } catch (error) {
    throw new Error("That image could not be read", { cause: error });
  }
}

export async function loadPitchFiles(assets: PitchAsset[]): Promise<BinaryFiles> {
  const files: BinaryFiles = {};
  await Promise.all(
    assets
      .filter((asset) => asset.kind === "image" && asset.fileId && asset.url)
      .map(async (asset) => {
        try {
          const response = await fetchWithRetry(asset.url!, undefined, {
            retries: 1,
            timeoutMs: 12_000,
          });
          if (!response.ok) throw new Error("The stored image is unavailable");
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
          files[asset.fileId as FileId] = unavailableImageFile(asset);
        }
      }),
  );
  for (const asset of assets.filter(
    (candidate) =>
      candidate.kind === "image" && candidate.fileId && candidate.availability === "unavailable",
  )) {
    files[asset.fileId as FileId] = unavailableImageFile(asset);
  }
  return files;
}

function unavailableImageFile(asset: PitchAsset): BinaryFileData {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the missing-image placeholder");
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--stone-100").trim() || "Canvas";
  const foreground = styles.getPropertyValue("--foreground").trim() || "CanvasText";
  const border = styles.getPropertyValue("--stone-300").trim() || foreground;
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = border;
  context.lineWidth = 4;
  context.setLineDash([16, 12]);
  context.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);
  context.setLineDash([]);
  context.fillStyle = foreground;
  context.textAlign = "center";
  context.font = "600 28px ui-monospace, monospace";
  context.fillText("image unavailable", canvas.width / 2, canvas.height / 2 - 8);
  context.font = "18px ui-monospace, monospace";
  const name = asset.fileName.length > 64 ? `${asset.fileName.slice(0, 61)}…` : asset.fileName;
  context.fillText(name, canvas.width / 2, canvas.height / 2 + 32);
  return {
    id: asset.fileId as FileId,
    dataURL: canvas.toDataURL("image/png") as DataURL,
    mimeType: "image/png",
    created: new Date(asset.createdAt).getTime(),
  };
}
