import {
  deleteObjects,
  downloadBuffer,
  headObject,
  isConfigured,
  listObjects,
  uploadBuffer,
} from "@/lib/platform/object-storage-provider-context.server";
import type { StorageScope } from "@/lib/platform/r2.server";
import {
  MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL,
  PRIVATE_MEDIA_CACHE_CONTROL,
} from "@/lib/shared/media-cache";
import type { ResponsiveImageData, ResponsiveImageMetadata } from "@/features/media/image";
import type { WordMediaTarget } from "./upload";
import {
  parseWordImageLocation,
  wordImageData,
  wordImageManifestKey,
  wordImageVariantKey,
  type WordImageManifest,
} from "./image";

function targetId(target: WordMediaTarget): string {
  return target.scope === "asset" ? `asset:${target.assetId}` : `word:${target.slug}`;
}

async function readWordImageManifest(
  target: WordMediaTarget,
  scope: StorageScope,
): Promise<WordImageManifest> {
  const key = wordImageManifestKey(target);
  const object = await headObject(key, { scope });
  if (!object.exists) return {};
  const raw = await downloadBuffer(key, { scope });
  const parsed = JSON.parse(raw.toString("utf-8")) as WordImageManifest;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

async function writeWordImageManifest(
  target: WordMediaTarget,
  manifest: WordImageManifest,
  scope: StorageScope,
): Promise<void> {
  await uploadBuffer(
    wordImageManifestKey(target),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf-8"),
    "application/json; charset=utf-8",
    {
      scope,
      cacheControl:
        scope === "public" ? MUTABLE_PUBLIC_MEDIA_CACHE_CONTROL : PRIVATE_MEDIA_CACHE_CONTROL,
    },
  );
}

async function mergeWordImageMetadata(
  target: WordMediaTarget,
  entries: Record<string, ResponsiveImageMetadata>,
  scope: StorageScope,
): Promise<void> {
  const current = await readWordImageManifest(target, scope);
  await writeWordImageManifest(target, { ...current, ...entries }, scope);
}

async function pruneWordImageVariants(
  target: WordMediaTarget,
  filename: string,
  widths: number[],
  scope: StorageScope,
): Promise<number> {
  const stem = filename.replace(/\.[^.]+$/, "");
  const prefix = `${target.scope === "asset" ? `words/assets/${target.assetId}` : `words/media/${target.slug}`}/_responsive/${stem}/`;
  const expected = new Set(
    widths.flatMap((width) =>
      (["avif", "webp"] as const).map((format) =>
        wordImageVariantKey(target, filename, width, format),
      ),
    ),
  );
  const objects = await listObjects(prefix, { scope });
  return deleteObjects(
    objects.filter((object) => !expected.has(object.key)).map((object) => object.key),
    { scope },
  );
}

async function loadWordImageData(input: {
  refs: string[];
  wordSlug: string;
  privacy: "public" | "private";
}): Promise<Record<string, ResponsiveImageData>> {
  if (!isConfigured()) return {};
  const locations = input.refs
    .map((ref) => ({ ref, location: parseWordImageLocation(ref, input.wordSlug) }))
    .filter(
      (item): item is { ref: string; location: NonNullable<typeof item.location> } =>
        !!item.location,
    );
  const targets = new Map<string, { target: WordMediaTarget; scope: StorageScope }>();
  for (const { location } of locations) {
    const scope: StorageScope =
      location.target.scope === "word" && input.privacy === "private" ? "private" : "public";
    targets.set(targetId(location.target), { target: location.target, scope });
  }
  const manifests = new Map<string, WordImageManifest>();
  await Promise.all(
    [...targets.entries()].map(async ([id, { target, scope }]) => {
      manifests.set(id, await readWordImageManifest(target, scope));
    }),
  );

  return Object.fromEntries(
    locations.flatMap(({ ref, location }) => {
      const metadata = manifests.get(targetId(location.target))?.[location.filename];
      return metadata ? [[ref, wordImageData(location, metadata, input.privacy)]] : [];
    }),
  );
}

export {
  loadWordImageData,
  mergeWordImageMetadata,
  pruneWordImageVariants,
  readWordImageManifest,
  writeWordImageManifest,
};
