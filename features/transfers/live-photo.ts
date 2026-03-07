import type { FileKind } from "@/features/media/file-kinds";

const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;

type LivePhotoCandidate = {
  id: string;
  filename: string;
  kind: FileKind;
};

type LivePhotoVisualItem<T extends LivePhotoCandidate> =
  | { id: string; type: "single"; file: T }
  | { id: string; type: "live"; photo: T; motion: T; stem: string };

function getFilenameStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function getLivePhotoStem(filename: string): string {
  return getFilenameStem(filename).toLowerCase();
}

function isLivePhotoCandidatePhoto<T extends LivePhotoCandidate>(file: T): boolean {
  return file.kind === "image" && !RAW_IMAGE_EXTENSIONS.test(file.filename);
}

function isLivePhotoCandidateMotion<T extends LivePhotoCandidate>(file: T): boolean {
  return file.kind === "video";
}

function buildLivePhotoVisualItems<T extends LivePhotoCandidate>(
  files: readonly T[]
): LivePhotoVisualItem<T>[] {
  const motionByStem = new Map<string, T[]>();
  for (const file of files) {
    if (!isLivePhotoCandidateMotion(file)) continue;
    const stem = getLivePhotoStem(file.filename);
    const bucket = motionByStem.get(stem);
    if (bucket) bucket.push(file);
    else motionByStem.set(stem, [file]);
  }

  const usedIds = new Set<string>();
  const items: LivePhotoVisualItem<T>[] = [];

  for (const file of files) {
    if (usedIds.has(file.id)) continue;

    if (isLivePhotoCandidatePhoto(file)) {
      const stem = getLivePhotoStem(file.filename);
      const motion = motionByStem.get(stem)?.find((candidate) => !usedIds.has(candidate.id));
      if (motion) {
        usedIds.add(file.id);
        usedIds.add(motion.id);
        items.push({
          id: `live:${file.id}:${motion.id}`,
          type: "live",
          photo: file,
          motion,
          stem,
        });
        continue;
      }
    }

    usedIds.add(file.id);
    items.push({
      id: `single:${file.id}`,
      type: "single",
      file,
    });
  }

  return items;
}

export { buildLivePhotoVisualItems, getLivePhotoStem };
export type { LivePhotoCandidate, LivePhotoVisualItem };
