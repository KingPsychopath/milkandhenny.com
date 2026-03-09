"use client";

interface ZipSourceFile {
  id: string;
  filename: string;
  url: string;
  size?: number;
}

interface ZipProgress {
  phase: "fetching" | "zipping";
  done: number;
  total: number;
}

interface BuildZipArchiveOptions {
  files: ZipSourceFile[];
  onProgress?: (progress: ZipProgress) => void;
  saveTarget?: ZipSaveTarget;
  signal?: AbortSignal;
}

interface ZipSaveTarget {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: string): Promise<void>;
}

interface BlobZipResult {
  type: "blob";
  blob: Blob;
}

interface SavedZipResult {
  type: "saved";
}

type BuildZipArchiveResult = BlobZipResult | SavedZipResult;

interface ZipEntryRecord {
  crc32: number;
  filenameBytes: Uint8Array;
  offset: number;
  size: number;
  dosDate: number;
  dosTime: number;
}

const textEncoder = new TextEncoder();
const ZIP_VERSION = 45;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_GENERAL_PURPOSE_FLAGS = ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG;
const ZIP_STORE_METHOD = 0;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP64_UINT32_SENTINEL = 0xffffffff;
const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (0xedb88320 ^ (crc >>> 1)) >>> 0 : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
}

function updateCrc32(seed: number, chunk: Uint8Array): number {
  let crc = seed >>> 0;
  for (let index = 0; index < chunk.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function finalizeCrc32(seed: number): number {
  return (seed ^ 0xffffffff) >>> 0;
}

function getDosDateTime(value = new Date()): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, value.getFullYear());
  const month = value.getMonth() + 1;
  const day = value.getDate();
  const hours = value.getHours();
  const minutes = value.getMinutes();
  const seconds = Math.floor(value.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds,
  };
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function writeUint64(view: DataView, offset: number, value: number) {
  const low = value >>> 0;
  const high = Math.floor(value / 0x100000000) >>> 0;
  writeUint32(view, offset, low);
  writeUint32(view, offset + 4, high);
}

function copyChunk(chunk: Uint8Array): Uint8Array {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy;
}

function chunkToArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(chunk.byteLength);
  new Uint8Array(buffer).set(chunk);
  return buffer;
}

function concatChunks(chunks: ArrayBuffer[]): Blob {
  return new Blob(chunks, { type: "application/zip" });
}

function resolveArchiveFilenames(files: ZipSourceFile[]): Map<string, string> {
  const used = new Map<string, number>();
  const resolved = new Map<string, string>();

  for (const file of files) {
    const source = file.filename.trim() || `file-${file.id}`;
    const dotIndex = source.lastIndexOf(".");
    const hasExtension = dotIndex > 0 && dotIndex < source.length - 1;
    const base = hasExtension ? source.slice(0, dotIndex) : source;
    const extension = hasExtension ? source.slice(dotIndex) : "";
    const seen = used.get(source) ?? 0;
    used.set(source, seen + 1);
    resolved.set(file.id, seen === 0 ? source : `${base} (${seen + 1})${extension}`);
  }

  return resolved;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new DOMException("Download aborted", "AbortError");
  }
}

async function fetchFileStream(url: string, signal?: AbortSignal, retries = 2): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      throwIfAborted(signal);
      const response = await fetch(url, { mode: "cors", signal });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("Readable stream not available for download");
      return response;
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw signal?.reason instanceof Error ? signal.reason : error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

class BlobZipTarget implements ZipSaveTarget {
  private readonly chunks: ArrayBuffer[] = [];

  async write(chunk: Uint8Array) {
    this.chunks.push(chunkToArrayBuffer(chunk));
  }

  async close() {}

  async abort() {}

  toBlob(): Blob {
    return concatChunks(this.chunks);
  }
}

function buildLocalFileHeader(filenameBytes: Uint8Array, dosDate: number, dosTime: number): Uint8Array {
  const extraField = new Uint8Array(20);
  const extraFieldView = new DataView(extraField.buffer);
  writeUint16(extraFieldView, 0, ZIP64_EXTRA_FIELD_ID);
  writeUint16(extraFieldView, 2, 16);
  writeUint64(extraFieldView, 4, 0);
  writeUint64(extraFieldView, 12, 0);

  const header = new Uint8Array(30 + filenameBytes.length + extraField.length);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_GENERAL_PURPOSE_FLAGS);
  writeUint16(view, 8, ZIP_STORE_METHOD);
  writeUint16(view, 10, dosTime);
  writeUint16(view, 12, dosDate);
  writeUint32(view, 14, 0);
  writeUint32(view, 18, ZIP64_UINT32_SENTINEL);
  writeUint32(view, 22, ZIP64_UINT32_SENTINEL);
  writeUint16(view, 26, filenameBytes.length);
  writeUint16(view, 28, extraField.length);
  header.set(filenameBytes, 30);
  header.set(extraField, 30 + filenameBytes.length);
  return header;
}

function buildDataDescriptor(crc32: number, size: number): Uint8Array {
  const descriptor = new Uint8Array(24);
  const view = new DataView(descriptor.buffer);
  writeUint32(view, 0, 0x08074b50);
  writeUint32(view, 4, crc32);
  writeUint64(view, 8, size);
  writeUint64(view, 16, size);
  return descriptor;
}

function buildCentralDirectoryEntry(record: ZipEntryRecord): Uint8Array {
  const extraField = new Uint8Array(28);
  const extraFieldView = new DataView(extraField.buffer);
  writeUint16(extraFieldView, 0, ZIP64_EXTRA_FIELD_ID);
  writeUint16(extraFieldView, 2, 24);
  writeUint64(extraFieldView, 4, record.size);
  writeUint64(extraFieldView, 12, record.size);
  writeUint64(extraFieldView, 20, record.offset);

  const entry = new Uint8Array(46 + record.filenameBytes.length + extraField.length);
  const view = new DataView(entry.buffer);

  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_VERSION);
  writeUint16(view, 8, ZIP_GENERAL_PURPOSE_FLAGS);
  writeUint16(view, 10, ZIP_STORE_METHOD);
  writeUint16(view, 12, record.dosTime);
  writeUint16(view, 14, record.dosDate);
  writeUint32(view, 16, record.crc32);
  writeUint32(view, 20, ZIP64_UINT32_SENTINEL);
  writeUint32(view, 24, ZIP64_UINT32_SENTINEL);
  writeUint16(view, 28, record.filenameBytes.length);
  writeUint16(view, 30, extraField.length);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, ZIP64_UINT32_SENTINEL);
  entry.set(record.filenameBytes, 46);
  entry.set(extraField, 46 + record.filenameBytes.length);
  return entry;
}

function buildEndOfCentralDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
  const zip64Record = new Uint8Array(56);
  const zip64RecordView = new DataView(zip64Record.buffer);
  writeUint32(zip64RecordView, 0, 0x06064b50);
  writeUint64(zip64RecordView, 4, 44);
  writeUint16(zip64RecordView, 12, ZIP_VERSION);
  writeUint16(zip64RecordView, 14, ZIP_VERSION);
  writeUint32(zip64RecordView, 16, 0);
  writeUint32(zip64RecordView, 20, 0);
  writeUint64(zip64RecordView, 24, entryCount);
  writeUint64(zip64RecordView, 32, entryCount);
  writeUint64(zip64RecordView, 40, directorySize);
  writeUint64(zip64RecordView, 48, directoryOffset);

  const zip64Locator = new Uint8Array(20);
  const zip64LocatorView = new DataView(zip64Locator.buffer);
  writeUint32(zip64LocatorView, 0, 0x07064b50);
  writeUint32(zip64LocatorView, 4, 0);
  writeUint64(zip64LocatorView, 8, directoryOffset + directorySize);
  writeUint32(zip64LocatorView, 16, 1);

  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);

  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, 0xffff);
  writeUint16(view, 10, 0xffff);
  writeUint32(view, 12, ZIP64_UINT32_SENTINEL);
  writeUint32(view, 16, ZIP64_UINT32_SENTINEL);
  writeUint16(view, 20, 0);

  const combined = new Uint8Array(zip64Record.length + zip64Locator.length + footer.length);
  combined.set(zip64Record, 0);
  combined.set(zip64Locator, zip64Record.length);
  combined.set(footer, zip64Record.length + zip64Locator.length);
  return combined;
}

async function writeFileEntry(
  file: ZipSourceFile,
  filename: string,
  target: ZipSaveTarget,
  offset: number,
  signal?: AbortSignal
): Promise<{ bytesWritten: number; record: ZipEntryRecord }> {
  throwIfAborted(signal);
  const filenameBytes = textEncoder.encode(filename);
  const { dosDate, dosTime } = getDosDateTime();
  const localHeader = buildLocalFileHeader(filenameBytes, dosDate, dosTime);

  await target.write(localHeader);

  const response = await fetchFileStream(file.url, signal);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Readable stream not available for download");

  let crc = 0xffffffff;
  let size = 0;
  let bytesWritten = localHeader.length;

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const chunk = copyChunk(value);
    crc = updateCrc32(crc, chunk);
    size += chunk.length;
    bytesWritten += chunk.length;
    await target.write(chunk);
  }

  const finalizedCrc = finalizeCrc32(crc);
  const descriptor = buildDataDescriptor(finalizedCrc, size);
  await target.write(descriptor);
  bytesWritten += descriptor.length;

  return {
    bytesWritten,
    record: {
      crc32: finalizedCrc,
      filenameBytes,
      offset,
      size,
      dosDate,
      dosTime,
    },
  };
}

async function writeCentralDirectory(records: ZipEntryRecord[], target: ZipSaveTarget, offset: number): Promise<number> {
  let directorySize = 0;

  for (const record of records) {
    const entry = buildCentralDirectoryEntry(record);
    await target.write(entry);
    directorySize += entry.length;
  }

  const footer = buildEndOfCentralDirectory(records.length, directorySize, offset);
  await target.write(footer);

  return directorySize + footer.length;
}

async function buildZipArchive({ files, onProgress, saveTarget, signal }: BuildZipArchiveOptions): Promise<BuildZipArchiveResult> {
  const target = saveTarget ?? new BlobZipTarget();
  const archiveFilenames = resolveArchiveFilenames(files);
  const records: ZipEntryRecord[] = [];
  let offset = 0;

  try {
    throwIfAborted(signal);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const result = await writeFileEntry(file, archiveFilenames.get(file.id) ?? file.filename, target, offset, signal);
      offset += result.bytesWritten;
      records.push(result.record);
      onProgress?.({ phase: "fetching", done: index + 1, total: files.length });
    }

    throwIfAborted(signal);
    onProgress?.({ phase: "zipping", done: 0, total: 1 });
    await writeCentralDirectory(records, target, offset);
    await target.close();
    onProgress?.({ phase: "zipping", done: 1, total: 1 });
  } catch (error) {
    await target.abort?.(error instanceof Error ? error.message : "Zip build failed");
    throw error;
  }

  if (target instanceof BlobZipTarget) {
    return { type: "blob", blob: target.toBlob() };
  }

  return { type: "saved" };
}

export type {
  BlobZipResult,
  BuildZipArchiveOptions,
  BuildZipArchiveResult,
  SavedZipResult,
  ZipProgress,
  ZipSaveTarget,
  ZipSourceFile,
};

export { buildZipArchive, resolveArchiveFilenames };
