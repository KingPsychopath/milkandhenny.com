/**
 * Blog upload helpers.
 *
 * Shared between the upload API route and the CLI's blog-ops.
 * Handles filename sanitisation, R2 key generation, and markdown snippets.
 */

import path from "path";
import { isProcessableImage } from "@/features/media/processing";
import type { FileKind } from "@/features/media/file-kinds";

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

/** Generate a ready-to-paste markdown snippet for a blog file. */
function toMarkdownSnippet(
  slug: string,
  filename: string,
  kind: FileKind
): string {
  const r2Path = `blog/${slug}/${filename}`;
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

export { sanitiseStem, toR2Filename, toMarkdownSnippet };
