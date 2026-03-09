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
const ZIP_VERSION = 20;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_GENERAL_PURPOSE_FLAGS = ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG;
const ZIP_STORE_METHOD = 0;
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

async function fetchFileStream(url: string, retries = 2): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error("Readable stream not available for download");
      return response;
    } catch (error) {
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
  const header = new Uint8Array(30 + filenameBytes.length);
  const view = new DataView(header.buffer);

  writeUint32(view, 0, 0x04034b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_GENERAL_PURPOSE_FLAGS);
  writeUint16(view, 8, ZIP_STORE_METHOD);
  writeUint16(view, 10, dosTime);
  writeUint16(view, 12, dosDate);
  writeUint32(view, 14, 0);
  writeUint32(view, 18, 0);
  writeUint32(view, 22, 0);
  writeUint16(view, 26, filenameBytes.length);
  writeUint16(view, 28, 0);
  header.set(filenameBytes, 30);
  return header;
}

function buildDataDescriptor(crc32: number, size: number): Uint8Array {
  const descriptor = new Uint8Array(16);
  const view = new DataView(descriptor.buffer);
  writeUint32(view, 0, 0x08074b50);
  writeUint32(view, 4, crc32);
  writeUint32(view, 8, size);
  writeUint32(view, 12, size);
  return descriptor;
}

function buildCentralDirectoryEntry(record: ZipEntryRecord): Uint8Array {
  const entry = new Uint8Array(46 + record.filenameBytes.length);
  const view = new DataView(entry.buffer);

  writeUint32(view, 0, 0x02014b50);
  writeUint16(view, 4, ZIP_VERSION);
  writeUint16(view, 6, ZIP_VERSION);
  writeUint16(view, 8, ZIP_GENERAL_PURPOSE_FLAGS);
  writeUint16(view, 10, ZIP_STORE_METHOD);
  writeUint16(view, 12, record.dosTime);
  writeUint16(view, 14, record.dosDate);
  writeUint32(view, 16, record.crc32);
  writeUint32(view, 20, record.size);
  writeUint32(view, 24, record.size);
  writeUint16(view, 28, record.filenameBytes.length);
  writeUint16(view, 30, 0);
  writeUint16(view, 32, 0);
  writeUint16(view, 34, 0);
  writeUint16(view, 36, 0);
  writeUint32(view, 38, 0);
  writeUint32(view, 42, record.offset);
  entry.set(record.filenameBytes, 46);
  return entry;
}

function buildEndOfCentralDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);

  writeUint32(view, 0, 0x06054b50);
  writeUint16(view, 4, 0);
  writeUint16(view, 6, 0);
  writeUint16(view, 8, entryCount);
  writeUint16(view, 10, entryCount);
  writeUint32(view, 12, directorySize);
  writeUint32(view, 16, directoryOffset);
  writeUint16(view, 20, 0);
  return footer;
}

async function writeFileEntry(
  file: ZipSourceFile,
  filename: string,
  target: ZipSaveTarget,
  offset: number
): Promise<{ bytesWritten: number; record: ZipEntryRecord }> {
  const filenameBytes = textEncoder.encode(filename);
  const { dosDate, dosTime } = getDosDateTime();
  const localHeader = buildLocalFileHeader(filenameBytes, dosDate, dosTime);

  await target.write(localHeader);

  const response = await fetchFileStream(file.url);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Readable stream not available for download");

  let crc = 0xffffffff;
  let size = 0;
  let bytesWritten = localHeader.length;

  while (true) {
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

async function buildZipArchive({ files, onProgress, saveTarget }: BuildZipArchiveOptions): Promise<BuildZipArchiveResult> {
  const target = saveTarget ?? new BlobZipTarget();
  const archiveFilenames = resolveArchiveFilenames(files);
  const records: ZipEntryRecord[] = [];
  let offset = 0;

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const result = await writeFileEntry(file, archiveFilenames.get(file.id) ?? file.filename, target, offset);
      offset += result.bytesWritten;
      records.push(result.record);
      onProgress?.({ phase: "fetching", done: index + 1, total: files.length });
    }

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
