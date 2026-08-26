/// <reference lib="webworker" />
/* oxlint-disable unicorn/require-post-message-target-origin -- WorkerGlobalScope.postMessage has no targetOrigin parameter. */

type PrepareImageRequest = {
  id: number;
  bytes: ArrayBuffer;
  name: string;
  type: string;
  maxDimension: number;
  forceNormalize: boolean;
};

type PrepareImageResponse =
  | {
      id: number;
      ok: true;
      changed: false;
      width: number;
      height: number;
    }
  | {
      id: number;
      ok: true;
      changed: true;
      bytes: ArrayBuffer;
      name: string;
      type: "image/jpeg" | "image/png" | "image/webp";
      width: number;
      height: number;
    }
  | { id: number; ok: false; error: string };

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
const HEIF_MIME_TYPE_SET = new Set<string>(HEIF_MIME_TYPES);
const JPEG_QUALITY = 0.9;
const MAX_DECODE_PIXELS = 100_000_000;

function hasHeifExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return HEIF_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isHeifLikeFile(file: Pick<File, "name" | "type">): boolean {
  const type = file.type.toLowerCase();
  return hasHeifExtension(file.name) || HEIF_MIME_TYPE_SET.has(type);
}

function replaceExtension(filename: string, outputExtension: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return `${filename}.${outputExtension}`;
  const extension = filename
    .slice(lastDot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `${filename.slice(0, lastDot)}-${extension || "image"}.${outputExtension}`;
}

function inferHeifMimeType(file: Pick<File, "name" | "type">): string {
  if (HEIF_MIME_TYPE_SET.has(file.type.toLowerCase())) {
    return file.type.toLowerCase();
  }
  if (file.name.toLowerCase().endsWith(".heic")) return "image/heic";
  if (file.name.toLowerCase().endsWith(".hif")) return "image/hif";
  return "image/heif";
}

async function canNativeDecodeHeif(type: string): Promise<boolean> {
  if (typeof ImageDecoder === "undefined") return false;
  try {
    return await ImageDecoder.isTypeSupported(type);
  } catch {
    return false;
  }
}

async function decodeWithImageBitmap(
  bytes: ArrayBuffer,
  type: string,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
    imageOrientation: "none",
  });
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

function createCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

function getOrientedCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  orientation: number,
  maxDimension: number,
): OffscreenCanvas {
  const swap = orientation >= 5 && orientation <= 8;
  const orientedWidth = swap ? height : width;
  const orientedHeight = swap ? width : height;
  const scale = Math.min(1, maxDimension / Math.max(orientedWidth, orientedHeight));
  const canvas = createCanvas(
    Math.max(1, Math.round(orientedWidth * scale)),
    Math.max(1, Math.round(orientedHeight * scale)),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

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

function preferredOutputType(request: PrepareImageRequest): "image/jpeg" | "image/webp" {
  return /\.(png|webp|avif)$/i.test(request.name) ||
    ["image/png", "image/webp", "image/avif"].includes(request.type)
    ? "image/webp"
    : "image/jpeg";
}

async function canvasToBlob(
  canvas: OffscreenCanvas,
  requestedType: "image/jpeg" | "image/webp",
): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type: requestedType, quality: JPEG_QUALITY });
  if (["image/jpeg", "image/png", "image/webp"].includes(blob.type)) return blob;
  return canvas.convertToBlob({ type: "image/png" });
}

function isOutputImageType(value: string): value is "image/jpeg" | "image/png" | "image/webp" {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function getUint(view: DataView, offset: number, size: number): number {
  if (size === 0) return 0;
  if (size === 1) return view.getUint8(offset);
  if (size === 2) return view.getUint16(offset);
  if (size === 4) return view.getUint32(offset);
  if (size === 8) {
    const value = Number(view.getBigUint64(offset));
    if (!Number.isSafeInteger(value))
      throw new Error("HEIF metadata offset exceeds safe integer range");
    return value;
  }
  throw new Error(`Unsupported integer size ${size}`);
}

function parseBoxHead(
  view: DataView,
  offset: number,
): { kind: string; length: number; start: number } {
  const length32 = view.getUint32(offset);
  const kind = String.fromCharCode(
    view.getUint8(offset + 4),
    view.getUint8(offset + 5),
    view.getUint8(offset + 6),
    view.getUint8(offset + 7),
  );
  if (length32 === 1) {
    const length64 = Number(view.getBigUint64(offset + 8));
    return { kind, length: length64, start: offset + 16 };
  }
  return { kind, length: length32, start: offset + 8 };
}

function parseChildBoxes(
  view: DataView,
  start: number,
  length: number,
): Array<{ kind: string; offset: number; length: number; start: number }> {
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

function findBox(
  boxes: Array<{ kind: string; offset: number; length: number; start: number }>,
  kind: string,
) {
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
      view.getUint8(nameOffset + 3),
    );
    if (itemType !== "Exif") continue;
    return getUint(view, itemStart, idSize);
  }
  return null;
}

function findExtentInIloc(
  view: DataView,
  ilocBox: { start: number; length: number },
  wantedItemId: number,
): { offset: number; length: number } | null {
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

function extractJpegExifTiffBytes(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.byteLength) return null;
    if (
      marker === 0xe1 &&
      length >= 8 &&
      bytes[offset + 4] === 0x45 &&
      bytes[offset + 5] === 0x78 &&
      bytes[offset + 6] === 0x69 &&
      bytes[offset + 7] === 0x66 &&
      bytes[offset + 8] === 0x00 &&
      bytes[offset + 9] === 0x00
    ) {
      return bytes.slice(offset + 10, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

function normalizeExifOrientation(tiffBytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(tiffBytes);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  const byteOrder = view.getUint16(0);
  const littleEndian = byteOrder === 0x4949;
  const ifd0Offset = littleEndian ? view.getUint32(4, true) : view.getUint32(4, false);
  if (ifd0Offset + 2 > copy.byteLength) return copy;
  const entryCount = littleEndian
    ? view.getUint16(ifd0Offset, true)
    : view.getUint16(ifd0Offset, false);

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifd0Offset + 2 + index * 12;
    if (entryOffset + 12 > copy.byteLength) return copy;
    const tag = littleEndian
      ? view.getUint16(entryOffset, true)
      : view.getUint16(entryOffset, false);
    if (tag !== 0x0112) continue;
    const type = littleEndian
      ? view.getUint16(entryOffset + 2, true)
      : view.getUint16(entryOffset + 2, false);
    const count = littleEndian
      ? view.getUint32(entryOffset + 4, true)
      : view.getUint32(entryOffset + 4, false);
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

async function decodeWithImageDecoder(
  bytes: ArrayBuffer,
  type: string,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const decoder = new ImageDecoder({
    data: bytes,
    type,
  });
  const { image } = await decoder.decode();
  return {
    source: image,
    width: image.displayWidth,
    height: image.displayHeight,
    close: () => {
      image.close();
      decoder.close();
    },
  };
}

async function readOrientation(bytes: ArrayBuffer): Promise<number> {
  try {
    const exifr = await import("exifr");
    return (await exifr.orientation(bytes)) ?? 1;
  } catch {
    return 1;
  }
}

async function decodeWithLibheif(
  bytes: ArrayBuffer,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  const imported = await import("libheif-js/wasm-bundle");
  const libheif = (imported.default ?? imported) as unknown as LibheifLike;
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(bytes);
  const image = images.find((candidate) => candidate.is_primary()) ?? images[0];

  if (!image) throw new Error("No HEIF image found");

  const width = image.get_width();
  const height = image.get_height();
  if (width < 1 || height < 1 || width * height > MAX_DECODE_PIXELS) {
    images.forEach((candidate) => candidate.free());
    throw new Error("Image dimensions exceed the browser preparation limit");
  }
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

async function prepareImage(request: PrepareImageRequest): Promise<PrepareImageResponse> {
  const orientation = await readOrientation(request.bytes);
  const bytes = new Uint8Array(request.bytes);
  const heif = isHeifLikeFile(request);
  let exifTiff: Uint8Array | null = null;
  try {
    exifTiff = heif ? extractHeifExifTiffBytes(bytes) : extractJpegExifTiffBytes(bytes);
  } catch {
    exifTiff = null;
  }
  let normalizedExif: Uint8Array | null = null;
  try {
    normalizedExif = exifTiff ? normalizeExifOrientation(exifTiff) : null;
  } catch {
    normalizedExif = null;
  }
  const type = heif ? inferHeifMimeType(request) : request.type;
  let decoded: { source: CanvasImageSource; width: number; height: number; close: () => void };
  if (!heif || (await canNativeDecodeHeif(type))) {
    try {
      decoded = heif
        ? await decodeWithImageDecoder(request.bytes, type)
        : await decodeWithImageBitmap(request.bytes, type);
    } catch {
      if (!heif) throw new Error(`This browser cannot decode ${request.name}`);
      decoded = await decodeWithLibheif(request.bytes);
    }
  } else {
    decoded = await decodeWithLibheif(request.bytes);
  }

  try {
    const swap = orientation >= 5 && orientation <= 8;
    const orientedWidth = swap ? decoded.height : decoded.width;
    const orientedHeight = swap ? decoded.width : decoded.height;
    const shouldChange =
      heif ||
      request.forceNormalize ||
      Math.max(orientedWidth, orientedHeight) > request.maxDimension;
    if (!shouldChange) {
      return {
        id: request.id,
        ok: true,
        changed: false,
        width: orientedWidth,
        height: orientedHeight,
      };
    }
    const canvas = getOrientedCanvas(
      decoded.source,
      decoded.width,
      decoded.height,
      orientation,
      request.maxDimension,
    );
    const requestedType = preferredOutputType(request);
    const encodedBlob = await canvasToBlob(canvas, requestedType);
    const encodedBytes = new Uint8Array(await encodedBlob.arrayBuffer());
    const finalBlob =
      encodedBlob.type === "image/jpeg" && normalizedExif
        ? injectExifIntoJpeg(encodedBytes, normalizedExif)
        : new Blob([encodedBytes], { type: encodedBlob.type });
    const outputExtension =
      finalBlob.type === "image/webp" ? "webp" : finalBlob.type === "image/png" ? "png" : "jpg";
    if (!isOutputImageType(finalBlob.type))
      throw new Error("Browser returned an invalid image type");

    return {
      id: request.id,
      ok: true,
      changed: true,
      bytes: await finalBlob.arrayBuffer(),
      name: replaceExtension(request.name, outputExtension),
      type: finalBlob.type,
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    decoded.close();
  }
}

self.onmessage = async (event: MessageEvent<PrepareImageRequest>) => {
  try {
    const response = await prepareImage(event.data);
    if (response.ok && response.changed) {
      self.postMessage(response, { transfer: [response.bytes] });
      return;
    }
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? error.message : "Image preparation failed",
    } satisfies PrepareImageResponse);
  }
};
