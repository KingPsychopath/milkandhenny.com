/**
 * Words media upload helpers.
 *
 * Shared between upload API routes and CLI media operations.
 * Handles filename sanitisation, R2 key generation, and markdown snippets.
 */

import path from "path";
import { isProcessableImage } from "@/features/media/processing";
import type { FileKind } from "@/features/media/file-kinds";

const SAFE_MEDIA_TARGET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type WordMediaTarget =
  | { scope: "word"; slug: string }
  | { scope: "asset"; assetId: string };

/** Sanitise a filename stem: lowercase, replace non-alphanumeric with hyphens. */
function sanitiseStem(filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build the R2 filename — images become .webp, everything else keeps its extension. */
function toR2Filename(localFilename: string): string {
  const sanitised = sanitiseStem(localFilename);
  if (isProcessableImage(localFilename)) {
    return `${sanitised}.webp`;
  }
  return `${sanitised}${path.extname(localFilename).toLowerCase()}`;
}

function isValidWordMediaTargetId(value: string): boolean {
  return SAFE_MEDIA_TARGET_ID.test(value);
}

function normaliseWordMediaTargetId(value: string): string {
  return value.trim().toLowerCase();
}

function parseWordMediaTarget(input: {
  scope?: string;
  slug?: string;
  assetId?: string;
}): { ok: true; target: WordMediaTarget } | { ok: false; error: string } {
  const rawScope = input.scope?.trim().toLowerCase();
  const scope = rawScope === "asset" ? "asset" : "word";
  const slug = normaliseWordMediaTargetId(input.slug ?? "");
  const assetId = normaliseWordMediaTargetId(input.assetId ?? "");

  if (scope === "asset" || (!rawScope && !slug && assetId)) {
    if (!assetId) {
      return { ok: false, error: "Asset ID is required for shared assets." };
    }
    if (!isValidWordMediaTargetId(assetId)) {
      return { ok: false, error: "Asset ID must use lowercase letters, numbers, and hyphens only." };
    }
    return { ok: true, target: { scope: "asset", assetId } };
  }

  if (!slug) {
    return { ok: false, error: "Slug is required for word media." };
  }
  if (!isValidWordMediaTargetId(slug)) {
    return { ok: false, error: "Slug must use lowercase letters, numbers, and hyphens only." };
  }
  return { ok: true, target: { scope: "word", slug } };
}

function mediaPrefixForTarget(target: WordMediaTarget): string {
  if (target.scope === "asset") return `words/assets/${target.assetId}/`;
  return `words/media/${target.slug}/`;
}

function mediaPathForTarget(target: WordMediaTarget, filename: string): string {
  return `${mediaPrefixForTarget(target)}${filename}`;
}

/** Generate a ready-to-paste markdown snippet for a media file. */
function toMarkdownSnippetForTarget(
  target: WordMediaTarget,
  filename: string,
  kind: FileKind
): string {
  const r2Path = mediaPathForTarget(target, filename);
  const label = filename.replace(/\.[^.]+$/, "");

  switch (kind) {
    case "image":
    case "video":
    case "gif":
      return `![${label}](${r2Path})`;
    default:
      return `[${label}](${r2Path})`;
  }
}

/** Backward-compatible helper for word-scoped media snippets. */
function toMarkdownSnippet(slug: string, filename: string, kind: FileKind): string {
  return toMarkdownSnippetForTarget({ scope: "word", slug }, filename, kind);
}

export {
  sanitiseStem,
  toR2Filename,
  toMarkdownSnippet,
  isValidWordMediaTargetId,
  parseWordMediaTarget,
  mediaPrefixForTarget,
  mediaPathForTarget,
  toMarkdownSnippetForTarget,
};

export type { WordMediaTarget };
