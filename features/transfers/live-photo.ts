import type { FileKind } from "@/features/media/file-kinds";
import type { AssetGroup, AssetGroupMember } from "./store";

const RAW_IMAGE_EXTENSIONS = /\.(dng|arw|cr2|cr3|nef|orf|raf|rw2|raw)$/i;
const VIEWABLE_STILL_EXTENSIONS = /\.(jpe?g|heic|heif|hif)$/i;
const HEIF_STILL_EXTENSIONS = /\.(heic|heif|hif)$/i;
const MAX_PAIR_TIME_DELTA_MS = 2000;

type TransferGroupableFile = {
  id: string;
  filename: string;
  kind: FileKind;
  mimeType: string;
  takenAt?: string;
  livePhotoContentId?: string;
  groupId?: string;
  groupRole?: AssetGroupMember["role"];
};

type TransferVisualItem<T extends TransferGroupableFile> =
  | { id: string; type: "single"; file: T }
  | { id: string; type: "live_photo"; groupId: string; primary: T; photo: T; motion: T }
  | { id: string; type: "raw_pair"; groupId: string; primary: T; raw: T };

function getFilenameStem(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function getLivePhotoStem(filename: string): string {
  return getFilenameStem(filename).toLowerCase();
}

function isRawImageFile<T extends TransferGroupableFile>(file: T): boolean {
  return file.kind === "image" && RAW_IMAGE_EXTENSIONS.test(file.filename);
}

function isViewableStillFile<T extends TransferGroupableFile>(file: T): boolean {
  return file.kind === "image" && !isRawImageFile(file) && VIEWABLE_STILL_EXTENSIONS.test(file.filename);
}

function isLivePhotoCandidatePhoto<T extends TransferGroupableFile>(file: T): boolean {
  return file.kind === "image" && !RAW_IMAGE_EXTENSIONS.test(file.filename);
}

function isLivePhotoCandidateMotion<T extends TransferGroupableFile>(file: T): boolean {
  return file.kind === "video";
}

function parseTimeMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function passesTimestampGate<T extends TransferGroupableFile>(left: T, right: T): boolean {
  const leftMs = parseTimeMs(left.takenAt);
  const rightMs = parseTimeMs(right.takenAt);
  if (leftMs === null || rightMs === null) return true;
  return Math.abs(leftMs - rightMs) <= MAX_PAIR_TIME_DELTA_MS;
}

function getStillPreferenceScore<T extends TransferGroupableFile>(file: T): number {
  const ext = file.filename.toLowerCase();
  if (HEIF_STILL_EXTENSIONS.test(ext)) return 3;
  if (/\.jpe?g$/i.test(ext)) return 2;
  return 1;
}

function buildGroupId(
  type: AssetGroup["type"],
  members: ReadonlyArray<{ fileId: string; role: AssetGroupMember["role"] }>
): string {
  const ordered = [...members].sort((a, b) => a.role.localeCompare(b.role) || a.fileId.localeCompare(b.fileId));
  return `${type}:${ordered.map((member) => `${member.role}:${member.fileId}`).join(":")}`;
}

function inferTransferAssetGroups<T extends TransferGroupableFile>(
  inputFiles: readonly T[]
): {
  files: Array<T & Pick<TransferGroupableFile, "groupId" | "groupRole">>;
  groups: AssetGroup[];
} {
  const files = inputFiles.map((file) => {
    const next = { ...file };
    delete next.groupId;
    delete next.groupRole;
    return next;
  }) as Array<T & Pick<TransferGroupableFile, "groupId" | "groupRole">>;

  const filesByStem = new Map<string, T[]>();
  for (const file of files) {
    const stem = getLivePhotoStem(file.filename);
    const bucket = filesByStem.get(stem);
    if (bucket) bucket.push(file);
    else filesByStem.set(stem, [file]);
  }

  const usedIds = new Set<string>();
  const groups: AssetGroup[] = [];

  for (const bucket of filesByStem.values()) {
    const raws = bucket.filter((file) => isRawImageFile(file) && !usedIds.has(file.id));
    const stills = bucket
      .filter((file) => isViewableStillFile(file) && !usedIds.has(file.id))
      .sort((a, b) => getStillPreferenceScore(b) - getStillPreferenceScore(a) || a.filename.localeCompare(b.filename));
    const motions = bucket.filter((file) => isLivePhotoCandidateMotion(file) && !usedIds.has(file.id));

    if (raws.length > 0 && stills.length > 0) {
      const raw = raws[0];
      const primary = stills.find((candidate) => passesTimestampGate(candidate, raw));
      if (primary) {
        const members: AssetGroupMember[] = [
          { fileId: primary.id, role: "primary", mimeType: primary.mimeType },
          { fileId: raw.id, role: "raw", mimeType: raw.mimeType },
        ];
        const groupId = buildGroupId("raw_pair", members);
        primary.groupId = groupId;
        primary.groupRole = "primary";
        raw.groupId = groupId;
        raw.groupRole = "raw";
        usedIds.add(primary.id);
        usedIds.add(raw.id);
        groups.push({
          id: groupId,
          type: "raw_pair",
          ...(primary.takenAt ? { capturedAt: primary.takenAt } : {}),
          members,
        });
        continue;
      }
    }

    const photos = bucket
      .filter((file) => isLivePhotoCandidatePhoto(file) && !usedIds.has(file.id))
      .sort((a, b) => Number(Boolean(b.livePhotoContentId)) - Number(Boolean(a.livePhotoContentId)) || a.filename.localeCompare(b.filename));
    const motion = motions[0];
    if (photos.length > 0 && motion) {
      const photo = photos.find((candidate) => passesTimestampGate(candidate, motion));
      if (photo) {
        const members: AssetGroupMember[] = [
          { fileId: photo.id, role: "primary", mimeType: photo.mimeType },
          { fileId: motion.id, role: "motion", mimeType: motion.mimeType },
        ];
        const groupId = buildGroupId("live_photo", members);
        photo.groupId = groupId;
        photo.groupRole = "primary";
        motion.groupId = groupId;
        motion.groupRole = "motion";
        usedIds.add(photo.id);
        usedIds.add(motion.id);
        groups.push({
          id: groupId,
          type: "live_photo",
          ...(photo.takenAt ? { capturedAt: photo.takenAt } : {}),
          members,
        });
      }
    }
  }

  return { files, groups };
}

function buildTransferVisualItems<T extends TransferGroupableFile>(
  files: readonly T[],
  groups?: readonly AssetGroup[]
): TransferVisualItem<T>[] {
  if (!groups || groups.length === 0) {
    return buildLegacyLivePhotoVisualItems(files);
  }

  const fileById = new Map(files.map((file) => [file.id, file]));
  const itemByFileId = new Map<string, TransferVisualItem<T>>();

  for (const group of groups) {
    const primaryMember = group.members.find((member) => member.role === "primary");
    if (!primaryMember) continue;
    const primary = fileById.get(primaryMember.fileId);
    if (!primary) continue;

    if (group.type === "live_photo") {
      const motionMember = group.members.find((member) => member.role === "motion");
      const motion = motionMember ? fileById.get(motionMember.fileId) : null;
      if (!motion) continue;
      const item: TransferVisualItem<T> = {
        id: group.id,
        type: "live_photo",
        groupId: group.id,
        primary,
        photo: primary,
        motion,
      };
      itemByFileId.set(primary.id, item);
      itemByFileId.set(motion.id, item);
      continue;
    }

    const rawMember = group.members.find((member) => member.role === "raw");
    const raw = rawMember ? fileById.get(rawMember.fileId) : null;
    if (!raw) continue;
    const item: TransferVisualItem<T> = {
      id: group.id,
      type: "raw_pair",
      groupId: group.id,
      primary,
      raw,
    };
    itemByFileId.set(primary.id, item);
    itemByFileId.set(raw.id, item);
  }

  const emitted = new Set<string>();
  const items: TransferVisualItem<T>[] = [];
  for (const file of files) {
    const groupedItem = itemByFileId.get(file.id);
    if (!groupedItem) {
      items.push({ id: `single:${file.id}`, type: "single", file });
      continue;
    }
    if (emitted.has(groupedItem.id)) continue;
    emitted.add(groupedItem.id);
    items.push(groupedItem);
  }

  return items;
}

function buildLegacyLivePhotoVisualItems<T extends TransferGroupableFile>(
  files: readonly T[]
): TransferVisualItem<T>[] {
  const motionByStem = new Map<string, T[]>();
  for (const file of files) {
    if (!isLivePhotoCandidateMotion(file)) continue;
    const stem = getLivePhotoStem(file.filename);
    const bucket = motionByStem.get(stem);
    if (bucket) bucket.push(file);
    else motionByStem.set(stem, [file]);
  }

  const usedIds = new Set<string>();
  const items: TransferVisualItem<T>[] = [];

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
          type: "live_photo",
          groupId: `legacy:${file.id}:${motion.id}`,
          primary: file,
          photo: file,
          motion,
        });
        continue;
      }
    }

    usedIds.add(file.id);
    items.push({ id: `single:${file.id}`, type: "single", file });
  }

  return items;
}

export { buildTransferVisualItems, getLivePhotoStem, inferTransferAssetGroups };
export type { TransferGroupableFile, TransferVisualItem };
