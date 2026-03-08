import * as exifr from "exifr";
import {
  RAW_PREVIEW_ACCEPTANCE_STEPS,
  RAW_PREVIEW_MAX_EMBEDDED_JPEG_CANDIDATES,
  RAW_PREVIEW_TARGET_LONGEST_EDGE,
} from "@/features/media/raw-preview";

type PreparedTransferUpload = {
  uploadFile: File;
  uploadName: string;
  originalFile?: File;
  convertedFrom?: "heic" | "raw";
  statusLabel?: string;
};

type HeifImageLike = {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: ImageData, callback: (result: ImageData | null) => void): void;
  free(): void;
};

type HeifDecoderLike = {
  decode(data: ArrayBuffer): HeifImageLike[];
};

type LibheifLike = {
  HeifDecoder: new () => HeifDecoderLike;
};

const HEIF_EXTENSIONS = [".heic", ".heif", ".hif"] as const;
const HEIF_MIME_TYPES = ["image/heic", "image/heif", "image/hif"] as const;
const RAW_EXTENSIONS = [".dng", ".arw", ".cr2", ".cr3", ".nef", ".orf", ".raf", ".rw2", ".raw"] as const;
const JPEG_QUALITY = 0.9;

function hasHeifExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return HEIF_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isHeifLikeFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.toLowerCase();
  return hasHeifExtension(file.name) || HEIF_MIME_TYPES.includes(type as (typeof HEIF_MIME_TYPES)[number]);
}

function hasRawExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isRawLikeFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.toLowerCase();
  return hasRawExtension(file.name) || type.startsWith("image/x-");
}

function isDerivableTransferFile(file: Pick<File, "name" | "type">): boolean {
  return isHeifLikeFile(file) || isRawLikeFile(file);
}

function replaceExtensionWithJpg(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return `${filename}.jpg`;
  return `${filename.slice(0, lastDot)}.jpg`;
}

async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to inspect derived preview dimensions"));
      img.src = objectUrl;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function resolveAcceptedRawPreviewThreshold(longestEdge: number): number | null {
  for (const threshold of RAW_PREVIEW_ACCEPTANCE_STEPS) {
    if (longestEdge >= threshold) return threshold;
  }
  return null;
}

type RawPreviewCandidate = {
  blob: Blob;
  width: number;
  height: number;
  longestEdge: number;
  acceptedThreshold: number;
  byteLength: number;
};

function compareRawPreviewCandidates(a: RawPreviewCandidate, b: RawPreviewCandidate): number {
  if (a.longestEdge !== b.longestEdge) return b.longestEdge - a.longestEdge;
  if (a.width !== b.width) return b.width - a.width;
  if (a.height !== b.height) return b.height - a.height;
  return b.byteLength - a.byteLength;
}

function copyPreviewBytes(preview: Uint8Array | ArrayBuffer): Uint8Array {
  const previewBytes = preview instanceof Uint8Array ? preview : new Uint8Array(preview);
  const previewCopy = new Uint8Array(previewBytes.byteLength);
  previewCopy.set(previewBytes);
  return previewCopy;
}

function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function inspectRawPreviewBlob(blob: Blob): Promise<RawPreviewCandidate> {
  const { width, height } = await getImageDimensions(blob);
  const longestEdge = Math.max(width, height);
  const acceptedThreshold = resolveAcceptedRawPreviewThreshold(longestEdge);
  if (acceptedThreshold === null) {
    throw new Error("Embedded RAW preview is too small");
  }

  return {
    blob,
    width,
    height,
    longestEdge,
    acceptedThreshold,
    byteLength: blob.size,
  };
}

function inferHeifMimeType(file: Pick<File, "name" | "type">): string {
  if (HEIF_MIME_TYPES.includes(file.type.toLowerCase() as (typeof HEIF_MIME_TYPES)[number])) {
    return file.type.toLowerCase();
  }
  if (file.name.toLowerCase().endsWith(".heic")) return "image/heic";
  if (file.name.toLowerCase().endsWith(".hif")) return "image/hif";
  return "image/heif";
}

async function canNativeDecodeHeif(type: string): Promise<boolean> {
  if (typeof window === "undefined" || !("ImageDecoder" in window)) return false;
  try {
    return await ImageDecoder.isTypeSupported(type);
  } catch {
    return false;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getOrientedCanvas(image: CanvasImageSource, width: number, height: number, orientation: number): HTMLCanvasElement {
  const swap = orientation >= 5 && orientation <= 8;
  const canvas = createCanvas(swap ? height : width, swap ? width : height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
    default:
      break;
  }

  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode JPEG"));
        return;
      }
      resolve(blob);
    }, "image/jpeg", JPEG_QUALITY);
  });
}

function getUint(view: DataView, offset: number, size: number): number {
  if (size === 0) return 0;
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset);
  if (size === 4) return view.getUint32(offset);
  if (size === 8) {
    const value = Number(view.getBigUint64(offset));
    if (!Number.isSafeInteger(value)) throw new Error("HEIF metadata offset exceeds safe integer range");
    return value;
  }
  throw new Error(`Unsupported integer size ${size}`);
}

function parseBoxHead(view: DataView, offset: number): { kind: string; length: number; start: number } {
  const length32 = view.getUint32(offset);
  const kind = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7)
  );
  if (length32 === 1) {
    const length64 = Number(view.getBigUint64(offset + 8));
    return { kind, length: length64, start: offset + 16 };
  }
  return { kind, length: length32, start: offset + 8 };
}

function parseChildBoxes(view: DataView, start: number, length: number): Array<{ kind: string; offset: number; length: number; start: number }> {
  const boxes: Array<{ kind: string; offset: number; length: number; start: number }> = [];
  let offset = start;
  const end = start + length;

  while (offset + 8 <= end) {
    const head = parseBoxHead(view, offset);
    if (head.length <= 0) break;
    boxes.push({ ...head, offset });
    offset += head.length;
  }

  return boxes;
}

function findBox(boxes: Array<{ kind: string; offset: number; length: number; start: number }>, kind: string) {
  return boxes.find((box) => box.kind === kind);
}

function findExifItemId(view: DataView, iinfBox: { start: number; length: number }): number | null {
  const subboxes = parseChildBoxes(view, iinfBox.start + 4, iinfBox.length - 4);
  for (const box of subboxes) {
    if (box.kind !== "infe") continue;
    const version = view.getUint8(box.start);
    const itemStart = box.start + 4;
    if (version < 2) continue;
    const idSize = version === 3 ? 4 : 2;
    const nameOffset = itemStart + idSize + 2;
    const itemType = String.fromCharCode(
      view.getUint8(nameOffset),
      view.getUint8(nameOffset + 1),
      view.getUint8(nameOffset + 2),
      view.getUint8(nameOffset + 3)
    );
    if (itemType !== "Exif") continue;
    return getUint(view, itemStart, idSize);
  }
  return null;
}

function findExtentInIloc(view: DataView, ilocBox: { start: number; length: number }, wantedItemId: number): { offset: number; length: number } | null {
  const version = view.getUint8(ilocBox.start);
  let offset = ilocBox.start + 4;
  const sizeByte = view.getUint8(offset);
  const offsetSize = sizeByte >> 4;
  const lengthSize = sizeByte & 0x0f;
  offset += 1;
  const secondSizeByte = view.getUint8(offset);
  const baseOffsetSize = secondSizeByte >> 4;
  const indexSize = secondSizeByte & 0x0f;
  offset += 1;
  const itemCountSize = version === 2 ? 4 : 2;
  const itemIdSize = version === 2 ? 4 : 2;
  const constructionMethodSize = version === 1 || version === 2 ? 2 : 0;
  let itemCount = getUint(view, offset, itemCountSize);
  offset += itemCountSize;

  while (itemCount > 0) {
    const itemId = getUint(view, offset, itemIdSize);
    offset += itemIdSize + constructionMethodSize + 2;
    const baseOffset = getUint(view, offset, baseOffsetSize);
    offset += baseOffsetSize;
    const extentCount = view.getUint16(offset);
    offset += 2;

    for (let index = 0; index < extentCount; index += 1) {
      if (indexSize > 0) offset += indexSize;
      const extentOffset = getUint(view, offset, offsetSize);
      offset += offsetSize;
      const extentLength = getUint(view, offset, lengthSize);
      offset += lengthSize;
      if (itemId === wantedItemId) {
        return { offset: baseOffset + extentOffset, length: extentLength };
      }
    }

    itemCount -= 1;
  }

  return null;
}

function extractHeifExifTiffBytes(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = view.getUint32(0);
  let metaBox: { kind: string; offset: number; length: number; start: number } | undefined;

  while (offset + 8 <= bytes.byteLength) {
    const head = parseBoxHead(view, offset);
    if (head.kind === "meta") {
      metaBox = { ...head, offset };
      break;
    }
    if (head.length <= 0) break;
    offset += head.length;
  }

  if (!metaBox) return null;

  const metaChildren = parseChildBoxes(view, metaBox.start + 4, metaBox.length - 4);
  const iinf = findBox(metaChildren, "iinf");
  const iloc = findBox(metaChildren, "iloc");
  if (!iinf || !iloc) return null;

  const exifItemId = findExifItemId(view, iinf);
  if (exifItemId === null) return null;

  const extent = findExtentInIloc(view, iloc, exifItemId);
  if (!extent || extent.offset + extent.length > bytes.byteLength) return null;

  const nameSize = view.getUint32(extent.offset);
  const tiffOffset = extent.offset + 4 + nameSize;
  const tiffLength = extent.length - 4 - nameSize;
  if (tiffOffset < 0 || tiffLength <= 0 || tiffOffset + tiffLength > bytes.byteLength) return null;
  return bytes.slice(tiffOffset, tiffOffset + tiffLength);
}

function normalizeExifOrientation(tiffBytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(tiffBytes);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const byteOrder = view.getUint16(0);
  const littleEndian = byteOrder === 0x4949;
  const ifd0Offset = littleEndian ? view.getUint32(4, true) : view.getUint32(4, false);
  if (ifd0Offset + 2 > copy.byteLength) return copy;
  const entryCount = littleEndian ? view.getUint16(ifd0Offset, true) : view.getUint16(ifd0Offset, false);

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifd0Offset + 2 + index * 12;
    if (entryOffset + 12 > copy.byteLength) return copy;
    const tag = littleEndian ? view.getUint16(entryOffset, true) : view.getUint16(entryOffset, false);
    if (tag !== 0x0112) continue;
    const type = littleEndian ? view.getUint16(entryOffset + 2, true) : view.getUint16(entryOffset + 2, false);
    const count = littleEndian ? view.getUint32(entryOffset + 4, true) : view.getUint32(entryOffset + 4, false);
    if (type !== 3 || count !== 1) return copy;
    if (littleEndian) {
      view.setUint16(entryOffset + 8, 1, true);
      view.setUint16(entryOffset + 10, 0, true);
    } else {
      view.setUint16(entryOffset + 8, 1, false);
      view.setUint16(entryOffset + 10, 0, false);
    }
    return copy;
  }

  return copy;
}

function injectExifIntoJpeg(jpegBytes: Uint8Array, tiffBytes: Uint8Array): Blob {
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new Error("JPEG output missing SOI marker");
  }

  const payloadLength = 6 + tiffBytes.length;
  const segmentLength = payloadLength + 2;
  if (segmentLength > 0xffff) {
    const jpegCopy = new Uint8Array(jpegBytes.byteLength);
    jpegCopy.set(jpegBytes);
    return new Blob([jpegCopy.buffer], { type: "image/jpeg" });
  }

  const segment = new Uint8Array(4 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (segmentLength >> 8) & 0xff;
  segment[3] = segmentLength & 0xff;
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  segment.set(tiffBytes, 10);

  const merged = new Uint8Array(jpegBytes.length + segment.length);
  merged.set(jpegBytes.slice(0, 2), 0);
  merged.set(segment, 2);
  merged.set(jpegBytes.slice(2), 2 + segment.length);
  const mergedCopy = new Uint8Array(merged.byteLength);
  mergedCopy.set(merged);
  return new Blob([mergedCopy.buffer], { type: "image/jpeg" });
}

async function decodeWithImageDecoder(file: File, type: string): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const decoder = new ImageDecoder({
    data: await file.arrayBuffer(),
    type,
  });
  const { image } = await decoder.decode();
  return {
    source: image,
    width: image.displayWidth,
    height: image.displayHeight,
    close: () => image.close(),
  };
}

async function readHeifOrientation(file: File): Promise<number> {
  try {
    return (await exifr.orientation(file)) ?? 1;
  } catch {
    return 1;
  }
}

async function decodeWithLibheif(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const imported = await import("libheif-js/wasm-bundle");
  const libheif = (imported.default ?? imported) as unknown as LibheifLike;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(await file.arrayBuffer());
  const image = images[0];

  if (!image) throw new Error("No HEIF image found");

  const width = image.get_width();
  const height = image.get_height();
  const imageData = new ImageData(width, height);

  await new Promise<void>((resolve, reject) => {
    image.display(imageData, (result) => {
      if (!result) {
        reject(new Error("HEIF decode failed"));
        return;
      }
      resolve();
    });
  });

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.putImageData(imageData, 0, 0);

  return {
    source: canvas,
    width,
    height,
    close: () => {
      images.forEach((candidate) => candidate.free());
    },
  };
}

async function convertHeifFile(file: File): Promise<File> {
  const orientation = await readHeifOrientation(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let exifTiff: Uint8Array | null = null;
  try {
    exifTiff = extractHeifExifTiffBytes(bytes);
  } catch {
    exifTiff = null;
  }
  const normalizedExif = exifTiff ? normalizeExifOrientation(exifTiff) : null;
  const type = inferHeifMimeType(file);
  let decoded: { source: CanvasImageSource; width: number; height: number; close: () => void };
  if (await canNativeDecodeHeif(type)) {
    try {
      decoded = await decodeWithImageDecoder(file, type);
    } catch {
      decoded = await decodeWithLibheif(file);
    }
  } else {
    decoded = await decodeWithLibheif(file);
  }

  try {
    const canvas = getOrientedCanvas(decoded.source, decoded.width, decoded.height, orientation);
    const jpegBlob = await canvasToJpegBlob(canvas);
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const finalBlob = normalizedExif
      ? injectExifIntoJpeg(jpegBytes, normalizedExif)
      : new Blob([jpegBytes], { type: "image/jpeg" });

    return new File([finalBlob], replaceExtensionWithJpg(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    decoded.close();
  }
}

async function extractRawPreviewFile(
  file: File
): Promise<{ file: File; longestEdge: number; acceptedThreshold: number }> {
  const candidates: RawPreviewCandidate[] = [];

  try {
    const preview = await exifr.thumbnail(file);
    if (preview) {
      const previewBlob = new Blob([toBlobPart(copyPreviewBytes(preview))], { type: "image/jpeg" });
      const exifrCandidate = await inspectRawPreviewBlob(previewBlob);
      if (exifrCandidate.longestEdge >= RAW_PREVIEW_TARGET_LONGEST_EDGE) {
        return {
          file: new File([exifrCandidate.blob], replaceExtensionWithJpg(file.name), {
            type: "image/jpeg",
            lastModified: file.lastModified,
          }),
          longestEdge: exifrCandidate.longestEdge,
          acceptedThreshold: exifrCandidate.acceptedThreshold,
        };
      }
      candidates.push(exifrCandidate);
    }
  } catch {
    // Keep searching for other embedded JPEG previews.
  }

  const rawBytes = new Uint8Array(await file.arrayBuffer());
  let inspectedCandidates = 0;
  let jpegStart = -1;
  for (let i = 0; i < rawBytes.length - 1; i++) {
    const a = rawBytes[i];
    const b = rawBytes[i + 1];

    if (jpegStart === -1 && a === 0xff && b === 0xd8) {
      jpegStart = i;
      i += 1;
      continue;
    }

    if (jpegStart !== -1 && a === 0xff && b === 0xd9) {
      const end = i + 2;
      const candidateBytes = rawBytes.slice(jpegStart, end);
      jpegStart = -1;
      i += 1;

      try {
        const candidate = await inspectRawPreviewBlob(new Blob([toBlobPart(candidateBytes)], { type: "image/jpeg" }));
        candidates.push(candidate);
        inspectedCandidates += 1;
        if (
          candidate.longestEdge >= RAW_PREVIEW_TARGET_LONGEST_EDGE ||
          inspectedCandidates >= RAW_PREVIEW_MAX_EMBEDDED_JPEG_CANDIDATES
        ) {
          break;
        }
      } catch {
        continue;
      }
    }
  }

  const bestCandidate = candidates.sort(compareRawPreviewCandidates)[0];
  if (!bestCandidate) {
    throw new Error("No embedded RAW preview found");
  }

  return {
    file: new File([bestCandidate.blob], replaceExtensionWithJpg(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    }),
    longestEdge: bestCandidate.longestEdge,
    acceptedThreshold: bestCandidate.acceptedThreshold,
  };
}

async function prepareTransferUploadFile(
  file: File,
  options: { derivePreview?: boolean } = {}
): Promise<PreparedTransferUpload> {
  if (!options.derivePreview || !isDerivableTransferFile(file)) {
    return {
      uploadFile: file,
      uploadName: file.name,
    };
  }

  if (isHeifLikeFile(file)) {
    const jpegFile = await convertHeifFile(file);
    return {
      uploadFile: jpegFile,
      uploadName: jpegFile.name,
      originalFile: file,
      convertedFrom: "heic",
      statusLabel: `prepared preview from ${file.name}`,
    };
  }

  try {
    const preview = await extractRawPreviewFile(file);
    return {
      uploadFile: preview.file,
      uploadName: preview.file.name,
      originalFile: file,
      convertedFrom: "raw",
      statusLabel:
        preview.acceptedThreshold >= 1024
          ? `extracted embedded preview from ${file.name} (${preview.longestEdge}px)`
          : `extracted low-res embedded preview from ${file.name} (${preview.longestEdge}px)`,
    };
  } catch {
    return {
      uploadFile: file,
      uploadName: file.name,
      statusLabel: `no usable embedded preview in ${file.name} — uploading original only`,
    };
  }
}

export {
  isDerivableTransferFile,
  isHeifLikeFile,
  isRawLikeFile,
  prepareTransferUploadFile,
};

export type { PreparedTransferUpload };
