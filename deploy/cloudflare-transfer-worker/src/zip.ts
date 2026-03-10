type ZipRequestFile = {
  key: string;
  filename: string;
};

type ZipEntryRecord = {
  crc32: number;
  filenameBytes: Uint8Array;
  offset: number;
  size: number;
  dosDate: number;
  dosTime: number;
};

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

function isSafeStorageKeySegment(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

function isAllowedDownloadStorageKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return false;
  if (normalized.includes("\\") || normalized.includes("..")) return false;

  const parts = normalized.split("/");
  if (
    parts.length === 4 &&
    parts[0] === "albums" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(parts[1]) &&
    parts[2] === "original" &&
    isSafeStorageKeySegment(parts[3]) &&
    /\.jpe?g$/i.test(parts[3])
  ) {
    return true;
  }

  if (
    parts.length === 4 &&
    parts[0] === "transfers" &&
    /^[a-z0-9_-]+(?:-[a-z0-9_-]+)*$/i.test(parts[1]) &&
    (parts[2] === "originals" || parts[2] === "derived") &&
    isSafeStorageKeySegment(parts[3])
  ) {
    return true;
  }

  return false;
}

function isSafeDownloadFilename(filename: string): boolean {
  const name = filename.trim();
  if (!name || name.length > 180) return false;
  if (name === "." || name === "..") return false;
  return isSafeStorageKeySegment(name) && !name.includes("..");
}

function encodeContentDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildAttachmentContentDisposition(filename: string): string {
  const quoted = filename.replace(/["\\]/g, "\\$&");
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encodeContentDispositionFilename(filename)}`;
}

function resolveArchiveFilenames(files: ZipRequestFile[]): Map<number, string> {
  const used = new Map<string, number>();
  const resolved = new Map<number, string>();

  files.forEach((file, index) => {
    const source = file.filename.trim() || `file-${index + 1}`;
    const dotIndex = source.lastIndexOf(".");
    const hasExtension = dotIndex > 0 && dotIndex < source.length - 1;
    const base = hasExtension ? source.slice(0, dotIndex) : source;
    const extension = hasExtension ? source.slice(dotIndex) : "";
    const seen = used.get(source) ?? 0;
    used.set(source, seen + 1);
    resolved.set(index, seen === 0 ? source : `${base} (${seen + 1})${extension}`);
  });

  return resolved;
}

async function streamZipFromPublicOrigin(params: {
  filename: string;
  files: ZipRequestFile[];
  publicBaseUrl: string;
}): Promise<Response> {
  if (!isSafeDownloadFilename(params.filename)) {
    return new Response("Invalid filename", { status: 400 });
  }
  if (!params.publicBaseUrl.trim()) {
    return new Response("R2 public URL not configured", { status: 500 });
  }
  if (params.files.length === 0) {
    return new Response("No files provided", { status: 400 });
  }
  if (params.files.length > 500) {
    return new Response("Too many files requested", { status: 400 });
  }
  if (
    params.files.some(
      (file) => !isAllowedDownloadStorageKey(file.key) || !isSafeDownloadFilename(file.filename)
    )
  ) {
    return new Response("Invalid file selection", { status: 400 });
  }

  const archiveFilenames = resolveArchiveFilenames(params.files);
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  const run = (async () => {
    const records: ZipEntryRecord[] = [];
    let offset = 0;

    try {
      const baseUrl = params.publicBaseUrl.replace(/\/+$/, "");

      for (let index = 0; index < params.files.length; index += 1) {
        const file = params.files[index];
        const filename = archiveFilenames.get(index) ?? file.filename;
        const filenameBytes = textEncoder.encode(filename);
        const { dosDate, dosTime } = getDosDateTime();
        const localHeader = buildLocalFileHeader(filenameBytes, dosDate, dosTime);
        await writer.write(localHeader);

        const response = await fetch(`${baseUrl}/${file.key}`);
        if (!response.ok || !response.body) {
          throw new Error(`Failed to fetch ${file.key}`);
        }

        const reader = response.body.getReader();
        let crc = 0xffffffff;
        let size = 0;
        let bytesWritten = localHeader.length;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          crc = updateCrc32(crc, value);
          size += value.length;
          bytesWritten += value.length;
          await writer.write(value);
        }

        const finalizedCrc = finalizeCrc32(crc);
        const descriptor = buildDataDescriptor(finalizedCrc, size);
        await writer.write(descriptor);
        bytesWritten += descriptor.length;

        records.push({
          crc32: finalizedCrc,
          filenameBytes,
          offset,
          size,
          dosDate,
          dosTime,
        });
        offset += bytesWritten;
      }

      let directorySize = 0;
      for (const record of records) {
        const entry = buildCentralDirectoryEntry(record);
        await writer.write(entry);
        directorySize += entry.length;
      }

      const footer = buildEndOfCentralDirectory(records.length, directorySize, offset);
      await writer.write(footer);
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  })();

  void run;

  return new Response(readable, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": buildAttachmentContentDisposition(params.filename),
      "cache-control": "no-store",
    },
  });
}

export { streamZipFromPublicOrigin };
export type { ZipRequestFile };
