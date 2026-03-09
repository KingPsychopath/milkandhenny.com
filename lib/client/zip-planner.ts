import type { ZipSourceFile } from "./streaming-zip";

type ZipPlanTotalBytes =
  | { known: true; bytes: number }
  | { known: false };

type ZipPlanPart = {
  files: ZipSourceFile[];
  total: ZipPlanTotalBytes;
};

type ZipPlan =
  | { mode: "streaming-single"; total: ZipPlanTotalBytes }
  | { mode: "blob-single"; total: { known: true; bytes: number } }
  | {
      mode: "blob-multipart";
      total: ZipPlanTotalBytes;
      partCount: number;
      partBytes: ZipPlanTotalBytes[];
      parts: ZipPlanPart[];
    }
  | { mode: "oversize-file"; filename: string; bytes: number };

type ZipPlannerOptions = {
  pickerAvailable: boolean;
  maxPartBytes: number;
};

function getKnownTotalBytes(files: ZipSourceFile[]): number {
  return files.reduce((sum, file) => sum + (typeof file.size === "number" ? file.size : 0), 0);
}

function getTotalBytes(files: ZipSourceFile[]): ZipPlanTotalBytes {
  return files.every((file) => typeof file.size === "number")
    ? { known: true, bytes: getKnownTotalBytes(files) }
    : { known: false };
}

function partitionFilesBySize(files: ZipSourceFile[], maxPartBytes: number): ZipPlanPart[] {
  const parts: ZipPlanPart[] = [];
  let currentFiles: ZipSourceFile[] = [];
  let currentBytes = 0;

  const pushCurrent = () => {
    if (currentFiles.length === 0) return;
    parts.push({
      files: currentFiles,
      total: { known: true, bytes: currentBytes },
    });
    currentFiles = [];
    currentBytes = 0;
  };

  for (const file of files) {
    if (typeof file.size !== "number") {
      pushCurrent();
      parts.push({
        files: [file],
        total: { known: false },
      });
      continue;
    }

    if (currentFiles.length > 0 && currentBytes + file.size > maxPartBytes) {
      pushCurrent();
    }

    currentFiles.push(file);
    currentBytes += file.size;
  }

  pushCurrent();
  return parts;
}

function planZipDownload(files: ZipSourceFile[], { pickerAvailable, maxPartBytes }: ZipPlannerOptions): ZipPlan {
  const total = getTotalBytes(files);

  // Evaluation order matters:
  // 1. Picker browsers always stream a single ZIP, even for files above the blob cap.
  if (pickerAvailable) {
    return { mode: "streaming-single", total };
  }

  // 2. Oversize-file only applies on the blob fallback path.
  const oversizeFile = files.find(
    (file) => typeof file.size === "number" && file.size > maxPartBytes
  );
  if (oversizeFile && typeof oversizeFile.size === "number") {
    return {
      mode: "oversize-file",
      filename: oversizeFile.filename,
      bytes: oversizeFile.size,
    };
  }

  // 3. Known totals above the cap must split into multiple blob ZIPs.
  if (total.known && total.bytes > maxPartBytes) {
    const parts = partitionFilesBySize(files, maxPartBytes);
    return {
      mode: "blob-multipart",
      total,
      partCount: parts.length,
      partBytes: parts.map((part) => part.total),
      parts,
    };
  }

  // 4. Unknown sizes still choose multipart conservatively on the blob path.
  if (!total.known) {
    const parts = partitionFilesBySize(files, maxPartBytes);
    return {
      mode: "blob-multipart",
      total,
      partCount: parts.length,
      partBytes: parts.map((part) => part.total),
      parts,
    };
  }

  // 5. Only fully-known selections under the cap can use a single blob ZIP.
  return {
    mode: "blob-single",
    total,
  };
}

function getMultipartArchiveName(archiveName: string, partIndex: number, partCount: number): string {
  if (archiveName.toLowerCase().endsWith(".zip")) {
    return archiveName.replace(/\.zip$/i, `-part-${partIndex}-of-${partCount}.zip`);
  }
  return `${archiveName}-part-${partIndex}-of-${partCount}.zip`;
}

export type { ZipPlan, ZipPlanPart, ZipPlanTotalBytes, ZipPlannerOptions };
export { getMultipartArchiveName, partitionFilesBySize, planZipDownload };
