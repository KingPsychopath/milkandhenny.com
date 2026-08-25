type TransferPresentationFile = {
  filename?: string;
  kind?: string;
  mimeType?: string;
  name?: string;
  originalFilename?: string;
  size?: number;
  type?: string;
};

type FileCategory =
  | "archive"
  | "audio"
  | "document"
  | "file"
  | "pdf"
  | "photo"
  | "presentation"
  | "spreadsheet"
  | "video";

const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;
const DOCUMENT_EXTENSIONS = /\.(doc|docx|odt|pages|rtf|txt)$/i;
const SPREADSHEET_EXTENSIONS = /\.(csv|numbers|ods|xls|xlsx)$/i;
const PRESENTATION_EXTENSIONS = /\.(key|odp|ppt|pptx)$/i;
const ARCHIVE_EXTENSIONS = /\.(7z|bz2|gz|rar|tar|tgz|zip)$/i;

const CATEGORY_LABELS: Record<FileCategory, { singular: string; plural: string }> = {
  archive: { singular: "archive", plural: "archives" },
  audio: { singular: "audio file", plural: "audio files" },
  document: { singular: "document", plural: "documents" },
  file: { singular: "file", plural: "files" },
  pdf: { singular: "PDF", plural: "PDFs" },
  photo: { singular: "photo", plural: "photos" },
  presentation: { singular: "presentation", plural: "presentations" },
  spreadsheet: { singular: "spreadsheet", plural: "spreadsheets" },
  video: { singular: "video", plural: "videos" },
};

function presentedFilename(file: TransferPresentationFile): string {
  return file.originalFilename ?? file.filename ?? file.name ?? "";
}

function fileCategory(file: TransferPresentationFile): FileCategory {
  const filename = presentedFilename(file);
  const mimeType = (file.mimeType ?? file.type ?? "").toLowerCase();

  if (file.kind === "image" || file.kind === "gif" || RAW_IMAGE_EXTENSIONS.test(filename)) {
    return "photo";
  }
  if (file.kind === "video" || mimeType.startsWith("video/")) return "video";
  if (file.kind === "audio" || mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (
    mimeType.includes("presentation") ||
    mimeType.includes("powerpoint") ||
    PRESENTATION_EXTENSIONS.test(filename)
  ) {
    return "presentation";
  }
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    SPREADSHEET_EXTENSIONS.test(filename)
  ) {
    return "spreadsheet";
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("word") ||
    DOCUMENT_EXTENSIONS.test(filename)
  ) {
    return "document";
  }
  if (
    mimeType.includes("zip") ||
    mimeType.includes("compressed") ||
    ARCHIVE_EXTENSIONS.test(filename)
  ) {
    return "archive";
  }
  return "file";
}

function describeTransferFiles(files: TransferPresentationFile[]): string {
  const counts = new Map<FileCategory, number>();
  for (const file of files) {
    const category = fileCategory(file);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => {
      const labels = CATEGORY_LABELS[category];
      return `${count} ${count === 1 ? labels.singular : labels.plural}`;
    })
    .join(", ");
}

function titleFromFilename(file: TransferPresentationFile): string | null {
  const basename = presentedFilename(file).replace(/\.[^.]+$/, "");
  const words = basename.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!words) return null;

  return words
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function inferTransferTitle(title: string, files: TransferPresentationFile[]): string {
  const trimmedTitle = title.trim();
  if (files.length !== 1) return trimmedTitle || "untitled";

  const inferredTitle = titleFromFilename(files[0]);
  if (!inferredTitle) return trimmedTitle || "untitled";
  if (!trimmedTitle || /^(file|files|transfer|untitled)$/i.test(trimmedTitle)) return inferredTitle;

  const category = fileCategory(files[0]);
  const titleCategory: Partial<Record<string, FileCategory>> = {
    audio: "audio",
    document: "document",
    documents: "document",
    pdf: "pdf",
    photo: "photo",
    photos: "photo",
    presentation: "presentation",
    presentations: "presentation",
    spreadsheet: "spreadsheet",
    spreadsheets: "spreadsheet",
    video: "video",
    videos: "video",
  };
  const claimedCategory = titleCategory[trimmedTitle.toLowerCase()];
  return claimedCategory && claimedCategory !== category ? inferredTitle : trimmedTitle;
}

function totalTransferBytes(files: TransferPresentationFile[]): number {
  return files.reduce((total, file) => total + (file.size ?? 0), 0);
}

export { describeTransferFiles, inferTransferTitle, totalTransferBytes };
export type { TransferPresentationFile };
