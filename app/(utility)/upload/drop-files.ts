type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: FileSystemEntryLike[]) => void, error?: (error: DOMException) => void) => void;
  };
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

type DataTransferItemLike = {
  kind: string;
  getAsFile: () => File | null;
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

function readFileEntry(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.isFile || !entry.file) {
      reject(new Error("Expected a file entry"));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readDirectoryEntries(entry: FileSystemEntryLike): Promise<FileSystemEntryLike[]> {
  if (!entry.isDirectory || !entry.createReader) return [];

  const reader = entry.createReader();
  const entries: FileSystemEntryLike[] = [];

  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    entries.push(...batch);
  }

  return entries;
}

async function walkEntry(entry: FileSystemEntryLike): Promise<File[]> {
  if (entry.isFile) {
    return [await readFileEntry(entry)];
  }

  if (!entry.isDirectory) return [];

  const entries = await readDirectoryEntries(entry);
  const nested = await Promise.all(entries.map((child) => walkEntry(child)));
  return nested.flat();
}

async function collectDroppedFilesFromItems(items: DataTransferItemLike[]): Promise<File[]> {
  const files: File[] = [];
  const directoryEntries: FileSystemEntryLike[] = [];

  for (const item of items) {
    if (item.kind !== "file") continue;

    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      directoryEntries.push(entry);
      continue;
    }

    const file = item.getAsFile();
    if (file) files.push(file);
  }

  if (directoryEntries.length === 0) return files;

  const nested = await Promise.all(directoryEntries.map((entry) => walkEntry(entry)));
  return [...files, ...nested.flat()];
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    return collectDroppedFilesFromItems(items);
  }

  return Array.from(dataTransfer.files ?? []);
}

export { collectDroppedFiles };
