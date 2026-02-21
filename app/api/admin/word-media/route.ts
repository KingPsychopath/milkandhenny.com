import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getImageUrl } from "@/features/media/storage";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isConfigured, listObjects } from "@/lib/platform/r2";

type MediaKind = "image" | "video" | "gif" | "audio" | "file";

type MediaItem = {
  key: string;
  filename: string;
  kind: MediaKind;
  size: number;
  lastModified?: string;
  url: string;
  markdown: string;
  assetId?: string;
};

const MAX_ITEMS_PER_SECTION = 300;
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "svg"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "ogg", "flac"]);

function toLabel(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function getKind(filename: string): MediaKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return ext === "gif" ? "gif" : "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "file";
}

function toMarkdown(path: string, filename: string): string {
  const label = toLabel(filename);
  const kind = getKind(filename);
  if (kind === "image" || kind === "video" || kind === "gif") {
    return `![${label}](${path})`;
  }
  return `[${label}](${path})`;
}

function parsePageMediaKey(key: string, slug: string): MediaItem | null {
  const prefix = `words/media/${slug}/`;
  if (!key.startsWith(prefix)) return null;
  if (key.includes("/incoming/")) return null;

  const filename = key.slice(prefix.length);
  if (!filename || filename.includes("/")) return null;

  return {
    key,
    filename,
    kind: getKind(filename),
    size: 0,
    url: getImageUrl(key),
    markdown: toMarkdown(key, filename),
  };
}

function parseAssetKey(key: string): MediaItem | null {
  if (!key.startsWith("words/assets/")) return null;
  if (key.includes("/incoming/")) return null;

  const parts = key.split("/");
  if (parts.length !== 4) return null;
  const assetId = parts[2];
  const filename = parts[3];
  if (!assetId || !filename) return null;

  return {
    key,
    assetId,
    filename,
    kind: getKind(filename),
    size: 0,
    url: getImageUrl(key),
    markdown: toMarkdown(key, filename),
  };
}

function applyObjectMeta(item: MediaItem, size: number, lastModified?: Date): MediaItem {
  return {
    ...item,
    size,
    lastModified: lastModified?.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const slug = request.nextUrl.searchParams.get("slug")?.trim().toLowerCase() ?? "";
    const includeAssets = request.nextUrl.searchParams.get("includeAssets") !== "false";

    if (!isConfigured()) {
      return NextResponse.json({
        slug,
        assetsIncluded: includeAssets,
        pageMedia: [],
        assets: [],
      });
    }

    const pagePromise = slug ? listObjects(`words/media/${slug}/`) : Promise.resolve([]);
    const assetPromise = includeAssets ? listObjects("words/assets/") : Promise.resolve([]);
    const [pageObjects, assetObjects] = await Promise.all([pagePromise, assetPromise]);

    const pageMedia = pageObjects
      .map((obj) => {
        const parsed = slug ? parsePageMediaKey(obj.key, slug) : null;
        return parsed ? applyObjectMeta(parsed, obj.size, obj.lastModified) : null;
      })
      .filter((item): item is MediaItem => item !== null)
      .sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""))
      .slice(0, MAX_ITEMS_PER_SECTION);

    const assets = assetObjects
      .map((obj) => {
        const parsed = parseAssetKey(obj.key);
        return parsed ? applyObjectMeta(parsed, obj.size, obj.lastModified) : null;
      })
      .filter((item): item is MediaItem => item !== null)
      .sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""))
      .slice(0, MAX_ITEMS_PER_SECTION);

    return NextResponse.json({
      slug,
      assetsIncluded: includeAssets,
      pageMedia,
      assets,
    });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.word-media", "Failed to load word media library", error);
  }
}
