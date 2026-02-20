#!/usr/bin/env tsx
/**
 * milk & henny — Album & R2 management CLI.
 *
 * Usage:
 *   pnpm cli                                  Interactive mode
 *   pnpm cli help                             Show all commands
 *   pnpm cli <command> [subcommand] [options]  Direct mode
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import {
  listAlbums,
  getAlbum,
  createAlbum,
  updateAlbumMeta,
  deleteAlbum,
  addPhotos,
  deletePhoto,
  setCover,
  setPhotoFocal,
  resetPhotoFocal,
  getPhotoKeys,
  backfillOgVariants,
} from "./album-ops";
import { validateAllAlbums } from "@/features/media/albums";
import { BASE_URL } from "@/lib/shared/config";
import {
  FOCAL_PRESETS,
  resolveFocalPreset,
  FOCAL_SHORTHAND,
} from "@/features/media/focal";
import {
  compareStrategies,
  DETECTION_STRATEGIES,
  type DetectionStrategy,
} from "./face-detect";
import {
  ROTATION_OVERRIDES,
  type RotationOverride,
} from "../features/media/processing";
import {
  listObjects,
  deleteObject,
  getBucketInfo,
} from "./r2-client";
import {
  createTransfer,
  getTransferInfo,
  listActiveTransfers,
  deleteTransfer,
  nukeAllTransfers,
  formatDuration,
  parseExpiry,
} from "./transfer-ops";
import {
  uploadBlogFiles,
  listBlogFiles,
  deleteBlogFile,
  deleteAllBlogFiles,
} from "./blog-ops";
import {
  REVOKE_ROLES,
  type RevokeRole,
  createStepUpToken,
  listTokenSessions,
  normalizeBaseUrl,
  revokeRoleSessions,
} from "./auth-ops";
import {
  createNoteRecord,
  createNoteShare,
  deleteNoteRecord,
  getNoteRecord,
  listNoteRecords,
  listNoteShares,
  revokeNoteShare,
  updateNoteRecord,
  updateNoteShare,
} from "./notes-ops";

/* ─── Formatting ─── */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

import { formatBytes } from "../lib/shared/format";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function log(msg: string) {
  console.log(`  ${msg}`);
}

function heading(title: string) {
  console.log();
  log(bold(title));
  log(dim("─".repeat(title.length)));
}

function progress(msg: string) {
  log(`${dim("›")} ${msg}`);
}

/**
 * Focal display for photo lists. Shows manual override or auto-detected face.
 * Returns "" if no focal info at all (center default).
 */
function formatFocalDisplay(
  photo: { focalPoint?: string; autoFocal?: { x: number; y: number } },
  style: "tag" | "detail"
): string {
  if (photo.focalPoint && photo.focalPoint !== "center") {
    const label = `focal: ${photo.focalPoint}`;
    return style === "tag" ? dim(` ${label}`) : ` · ${label}`;
  }
  if (photo.autoFocal) {
    const label = `face: ${photo.autoFocal.x}%,${photo.autoFocal.y}%`;
    return style === "tag" ? dim(` ${label}`) : ` · ${label}`;
  }
  return "";
}

/* ─── Validation ─── */

/** Validate slug format: lowercase letters, numbers, hyphens only */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/** Validate date format: YYYY-MM-DD */
function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + "T00:00:00");
  return !isNaN(parsed.getTime());
}

/** Validate directory exists and contains images */
function validateDir(dir: string): { valid: boolean; error?: string; count?: number } {
  const absDir = path.resolve(dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(absDir)) {
    return { valid: false, error: `Directory not found: ${absDir}` };
  }
  if (!fs.statSync(absDir).isDirectory()) {
    return { valid: false, error: `Not a directory: ${absDir}` };
  }
  const images = fs
    .readdirSync(absDir)
    .filter((f) => /\.(jpe?g|png|webp|heic|hif)$/i.test(f));
  if (images.length === 0) {
    return {
      valid: false,
      error: `No images found in ${absDir}. Supported: .jpg, .jpeg, .png, .webp, .heic, .hif`,
    };
  }
  return { valid: true, count: images.length };
}

/** Validate directory for transfers and blog — accepts ALL non-hidden files */
function validateAnyDir(dir: string): { valid: boolean; error?: string; count?: number } {
  const absDir = path.resolve(dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(absDir)) {
    return { valid: false, error: `Directory not found: ${absDir}` };
  }
  if (!fs.statSync(absDir).isDirectory()) {
    return { valid: false, error: `Not a directory: ${absDir}` };
  }
  const files = fs
    .readdirSync(absDir)
    .filter((f) => !f.startsWith(".") && fs.statSync(path.join(absDir, f)).isFile());
  if (files.length === 0) {
    return { valid: false, error: `No files found in ${absDir}` };
  }
  return { valid: true, count: files.length };
}

/** Keep the old name as an alias so transfer prompts still work */
const validateTransferDir = validateAnyDir;

/** List all blog post slugs from content/posts/ */
function getPostSlugs(): string[] {
  const postsDir = path.join(process.cwd(), "content", "posts");
  if (!fs.existsSync(postsDir)) return [];
  return fs
    .readdirSync(postsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/* ─── Interactive prompts ─── */

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

/** Ask for text input with optional hint and default value */
async function ask(
  question: string,
  opts?: { hint?: string; defaultVal?: string; required?: boolean }
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const parts: string[] = [question];
  if (opts?.hint) parts.push(dim(opts.hint));
  if (opts?.defaultVal) parts.push(dim(`[${opts.defaultVal}]`));

  return new Promise((resolve) => {
    rl.question(`  ${cyan("›")} ${parts.join(" ")} `, (answer) => {
      rl.close();
      const val = answer.trim() || opts?.defaultVal || "";
      resolve(val);
    });
  });
}

/** Ask for confirmation before destructive actions */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${yellow("?")} ${message} ${dim("(y/N)")} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

/** Show numbered options. Returns: selected index (1-based), 0 = back, -1 = invalid */
async function choose(
  title: string,
  options: { label: string; detail?: string }[]
): Promise<number> {
  console.log();
  log(bold(title));
  console.log();
  for (let i = 0; i < options.length; i++) {
    const detail = options[i].detail ? `  ${dim(options[i].detail!)}` : "";
    log(`  ${dim(`[${i + 1}]`)} ${options[i].label}${detail}`);
  }
  log(`  ${dim("[0]")} ${dim("← Back")}`);
  console.log();

  const answer = await ask("", { hint: "pick a number" });
  const num = parseInt(answer, 10);

  if (isNaN(num) || num < 0 || num > options.length) {
    log(yellow(`Invalid choice. Enter 0–${options.length}.`));
    return -1;
  }

  return num;
}

/** Select an album from the list. Returns slug or null. */
async function selectAlbum(): Promise<string | null> {
  const albums = listAlbums();
  if (albums.length === 0) {
    console.log();
    log(dim("No albums found. Upload one first with Albums → Upload."));
    return null;
  }

  const choice = await choose(
    "Select album",
    albums.map((a) => ({
      label: a.title,
      detail: `${a.slug} · ${formatDate(a.date)} · ${a.photoCount} photos`,
    }))
  );

  if (choice <= 0) return null;
  return albums[choice - 1].slug;
}

/** Select a photo from an album. Returns photo ID or null. */
async function selectPhoto(slug: string): Promise<string | null> {
  const album = getAlbum(slug);
  if (!album || album.photos.length === 0) {
    log(dim("No photos in this album."));
    return null;
  }

  const choice = await choose(
    `Photos in: ${album.title}`,
    album.photos.map((p) => ({
      label: `${p.id}${p.id === album.cover ? yellow(" ★ cover") : ""}`,
      detail: `${p.width} × ${p.height}${formatFocalDisplay(p, "detail")}`,
    }))
  );

  if (choice <= 0) return null;
  return album.photos[choice - 1].id;
}

/** Pause until enter is pressed */
async function pause() {
  await ask("", { hint: "press enter to continue" });
}

/* ─── Command handlers ─── */
/* These return void and never call process.exit — safe for interactive mode.
 * Errors are thrown, caught by the caller. */

async function cmdAlbumsList() {
  const albums = listAlbums();

  if (albums.length === 0) {
    heading("Albums");
    log(dim("No albums yet."));
    console.log();
    return;
  }

  heading(`Albums (${albums.length})`);
  const maxSlug = Math.max(...albums.map((a) => a.slug.length));

  for (const a of albums) {
    log(
      `${cyan(a.slug.padEnd(maxSlug + 2))} ${a.title.padEnd(35)} ${dim(formatDate(a.date))}  ${dim(`${a.photoCount} photos`)}`
    );
  }
  console.log();
}

async function cmdAlbumsShow(slug: string) {
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found.`);

  heading(album.title);
  log(`${dim("Slug:")}         ${album.slug}`);
  log(`${dim("Date:")}         ${formatDate(album.date)}`);
  if (album.description) {
    log(`${dim("Description:")}  ${album.description}`);
  }
  log(`${dim("Cover:")}        ${album.cover}`);
  log(`${dim("Photos:")}       ${album.photos.length}`);
  console.log();

  const maxId = Math.max(...album.photos.map((p) => p.id.length));

  for (const p of album.photos) {
    const coverTag = p.id === album.cover ? yellow(" ★") : "";
    log(
      `  ${p.id.padEnd(maxId + 2)} ${dim(`${p.width} × ${p.height}`)}${coverTag}${formatFocalDisplay(p, "tag")}`
    );
  }
  console.log();
}

async function cmdAlbumsUpload(opts: {
  dir: string;
  slug: string;
  title: string;
  date: string;
  description?: string;
  rotation?: RotationOverride;
}) {
  heading(`Uploading: ${opts.title}`);

  const { jsonPath, results } = await createAlbum(opts, (msg) =>
    progress(msg)
  );

  console.log();
  log(green(`✓ ${results.length} photos uploaded`));
  log(green(`✓ JSON written to ${jsonPath}`));

  const totalThumb = results.reduce((s, r) => s + r.thumbSize, 0);
  const totalFull = results.reduce((s, r) => s + r.fullSize, 0);
  const totalOrig = results.reduce((s, r) => s + r.originalSize, 0);

  console.log();
  log(dim("Size breakdown:"));
  log(`  Thumbnails:  ${formatBytes(totalThumb)}`);
  log(`  Full-size:   ${formatBytes(totalFull)}`);
  log(`  Originals:   ${formatBytes(totalOrig)}`);
  log(
    `  ${bold("Total:")}       ${formatBytes(totalThumb + totalFull + totalOrig)}`
  );
  console.log();
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdAlbumsUpdate(
  slug: string,
  updates: { title?: string; date?: string; description?: string; cover?: string }
) {
  const updated = updateAlbumMeta(slug, updates);
  if (!updated) throw new Error(`Album "${slug}" not found.`);

  heading("Updated");
  log(`${dim("Title:")}       ${updated.title}`);
  log(`${dim("Date:")}        ${formatDate(updated.date)}`);
  if (updated.description) {
    log(`${dim("Description:")} ${updated.description}`);
  }
  log(`${dim("Cover:")}       ${updated.cover}`);
  console.log();
  log(green("✓ Album metadata updated."));
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdAlbumsBackfillOg(skipConfirm = false, force = false, strategy?: DetectionStrategy) {
  heading("Backfill OG images");
  log(dim("Downloads originals from R2, generates 1200×630 JPGs for social sharing."));
  log(dim(force ? "Regenerating all (--force)." : "Skips photos that already have og/ variant."));
  log(dim(`Detection: ${strategy ?? "onnx (default)"}. Auto-detects faces for focal crop.`));
  console.log();

  const albums = listAlbums();
  if (albums.length === 0) {
    log(dim("No albums found."));
    console.log();
    return;
  }

  const totalPhotos = albums.reduce((sum, a) => sum + a.photoCount, 0);
  log(`${dim("Albums:")} ${albums.length}`);
  log(`${dim("Photos:")} ${totalPhotos}`);
  console.log();

  if (!skipConfirm) {
    const ok = await confirm(force ? "Regenerate all OG images?" : "Proceed with backfill?");
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
  }

  const result = await backfillOgVariants((msg) => progress(msg), { force, strategy });

  console.log();
  log(green(`✓ Processed: ${result.processed}`));
  if (result.skipped > 0) log(dim(`  Skipped (already exists): ${result.skipped}`));
  if (result.failed > 0) log(red(`  Failed: ${result.failed}`));
  log(dim("Next: run `pnpm build` — OG image generation will be faster."));
  console.log();
}

async function cmdAlbumsDelete(slug: string) {
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found.`);

  heading(`Delete: ${album.title}`);
  log(`${dim("Photos:")} ${album.photos.length}`);
  log(
    `${dim("R2 files:")} ~${album.photos.length * 4} (thumb + full + original + og per photo)`
  );
  console.log();

  const ok = await confirm(
    `${red("Permanently")} delete album "${slug}" and all its R2 files?`
  );
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await deleteAlbum(slug, (msg) => progress(msg));

  console.log();
  log(green(`✓ Deleted ${result.deletedFiles} files from R2`));
  log(green(`✓ JSON file ${result.jsonDeleted ? "deleted" : "not found"}`));
  log(dim("Next: commit the change and deploy."));
  console.log();
}

async function cmdAlbumsValidate() {
  heading("Validate album JSON");
  const results = validateAllAlbums();
  if (results.length === 0) {
    log(green("✓ All albums valid."));
    console.log();
    return;
  }
  for (const { slug, errors } of results) {
    log(red(`${slug}:`));
    for (const err of errors) {
      log(`  ${dim("—")} ${err}`);
    }
    console.log();
  }
  log(red(`✗ ${results.length} album(s) have validation errors.`));
  log(dim("Fix focalPoint (use a valid preset) or autoFocal (x, y in 0–100) in content/albums/*.json"));
  console.log();
  process.exit(1);
}

async function cmdPhotosList(slug: string) {
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found.`);

  heading(`${album.title} — Photos (${album.photos.length})`);

  if (album.photos.length === 0) {
    log(dim("No photos in this album."));
    console.log();
    return;
  }

  const maxId = Math.max(...album.photos.map((p) => p.id.length));

  for (const p of album.photos) {
    const coverTag = p.id === album.cover ? yellow(" ★ cover") : "";
    const keys = getPhotoKeys(slug, p.id);
    log(
      `${cyan(p.id.padEnd(maxId + 2))} ${dim(`${p.width} × ${p.height}`)}${coverTag}${formatFocalDisplay(p, "tag")}`
    );
    for (const k of keys) {
      log(`  ${dim(k)}`);
    }
  }
  console.log();
}

async function cmdPhotosAdd(slug: string, dir: string, rotation?: RotationOverride) {
  heading(`Adding photos to: ${slug}`);
  if (rotation) progress(`Rotation override: ${rotation}`);

  const { added, album } = await addPhotos(slug, dir, (msg) =>
    progress(msg),
    rotation,
  );

  console.log();
  if (added.length === 0) {
    log(yellow("No new photos to add (all already in album)."));
  } else {
    log(
      green(
        `✓ ${added.length} photos added. Album now has ${album.photos.length} photos.`
      )
    );
    log(dim("Next: commit the JSON and deploy."));
  }
  console.log();
}

async function cmdPhotosDelete(slug: string, photoId: string) {
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found.`);

  const photo = album.photos.find((p) => p.id === photoId);
  if (!photo) {
    const available = album.photos.map((p) => p.id).join(", ");
    throw new Error(
      `Photo "${photoId}" not found in album "${slug}". Available: ${available}`
    );
  }

  heading(`Delete photo: ${photoId}`);
  log(`${dim("Album:")} ${album.title}`);
  log(`${dim("Size:")}  ${photo.width} × ${photo.height}`);
  if (album.cover === photoId) {
    log(yellow("⚠ This photo is the current cover. A new cover will be set automatically."));
  }
  console.log();

  const ok = await confirm(`Delete "${photoId}" from R2 and album JSON?`);
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await deletePhoto(slug, photoId, (msg) => progress(msg));

  console.log();
  log(
    green(
      `✓ Deleted ${photoId} (${result.deletedKeys.length} files from R2)`
    )
  );
  log(green(`✓ Album now has ${result.album.photos.length} photos`));
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdPhotosSetCover(slug: string, photoId: string) {
  const album = setCover(slug, photoId);
  log(green(`✓ Cover set to "${photoId}" for album "${slug}".`));
  log(dim(`Album: ${album.title}`));
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdPhotosSetFocal(
  slug: string,
  photoId: string,
  preset: import("@/features/media/focal").FocalPreset
) {
  heading(`Set focal point: ${photoId}`);
  const album = await setPhotoFocal(slug, photoId, preset, (msg) =>
    progress(msg)
  );
  console.log();
  log(green(`✓ Focal set to "${preset}" — OG image regenerated.`));
  log(dim(`Album: ${album.title}`));
  log(dim("Applies to: OG images, album embed thumbnails."));
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdPhotosCompareFocal(slug: string, photoId: string) {
  heading(`Compare detection strategies: ${photoId}`);
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found`);
  if (!album.photos.some((p) => p.id === photoId)) {
    throw new Error(`Photo "${photoId}" not found in album "${slug}"`);
  }

  progress("Downloading original from R2...");
  const { downloadBuffer } = await import("./r2-client");
  const raw = await downloadBuffer(`albums/${slug}/original/${photoId}.jpg`);

  progress("Running all strategies...");
  const results = await compareStrategies(raw);

  console.log();
  for (const [name, result] of Object.entries(results)) {
    if (result) {
      log(`  ${cyan(name.padEnd(8))} → focal (${result.x}%, ${result.y}%)`);
    } else {
      log(`  ${cyan(name.padEnd(8))} → ${dim("no detection")}`);
    }
  }
  console.log();
  log(dim("Use --strategy <name> with reset-focal to apply a specific one."));
  console.log();
}

async function cmdPhotosResetFocal(slug: string, photoId?: string, strategy?: DetectionStrategy) {
  heading(
    photoId ? `Reset focal: ${photoId}` : `Reset focal: all photos in ${slug}`
  );
  if (strategy) progress(`Using ${strategy} detection strategy`);
  const album = await resetPhotoFocal(slug, photoId, (msg) => progress(msg), strategy);
  console.log();
  log(
    green(
      `✓ Focal reset — ${photoId ? "1 photo" : `${album.photos.length} photos`} re-detected and OG images regenerated.`
    )
  );
  log(dim("Manual overrides cleared. Auto-detected face positions applied."));
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdBucketLs(prefix = "") {
  heading(prefix ? `Bucket: ${prefix}` : "Bucket (root)");

  const objects = await listObjects(prefix);

  if (objects.length === 0) {
    log(dim("Empty — no objects found."));
    console.log();
    return;
  }

  /* Group by "folder" */
  const folders = new Map<string, { count: number; size: number }>();
  const files: typeof objects = [];

  for (const obj of objects) {
    const relative = prefix ? obj.key.slice(prefix.length) : obj.key;
    const slashIdx = relative.indexOf("/");

    if (slashIdx !== -1) {
      const folder = relative.slice(0, slashIdx + 1);
      const existing = folders.get(folder) ?? { count: 0, size: 0 };
      existing.count++;
      existing.size += obj.size;
      folders.set(folder, existing);
    } else if (relative) {
      files.push(obj);
    }
  }

  for (const [folder, info] of [...folders.entries()].sort()) {
    log(
      `${cyan(folder.padEnd(45))} ${dim(`${info.count} files`).padEnd(20)} ${dim(formatBytes(info.size))}`
    );
  }

  for (const f of files.sort((a, b) => a.key.localeCompare(b.key))) {
    const name = prefix ? f.key.slice(prefix.length) : f.key;
    log(`${name.padEnd(45)} ${dim(formatBytes(f.size))}`);
  }

  console.log();
  log(
    dim(
      `Total: ${objects.length} objects, ${formatBytes(objects.reduce((s, o) => s + o.size, 0))}`
    )
  );
  console.log();
}

async function cmdBucketRm(key: string) {
  log(`${dim("Key:")} ${key}`);
  console.log();

  const ok = await confirm(
    `Delete "${key}" from R2? ${dim("(⚠ This does NOT update album JSON — use 'photos delete' for that)")}`
  );
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  await deleteObject(key);
  log(green(`✓ Deleted ${key}`));
  console.log();
}

async function cmdBucketInfo() {
  heading("Bucket Info");
  log(dim("Calculating..."));

  const info = await getBucketInfo();

  log(`${dim("Objects:")}    ${info.totalObjects.toLocaleString()}`);
  log(
    `${dim("Total size:")} ${info.totalSizeMB} MB (${formatBytes(info.totalSizeBytes)})`
  );

  const pctUsed = (
    (info.totalSizeBytes / (10 * 1024 * 1024 * 1024)) *
    100
  ).toFixed(2);
  log(`${dim("Free tier:")}  ${pctUsed}% of 10 GB used`);
  console.log();
}

/* ─── Transfer command handlers ─── */

async function cmdTransfersList() {
  const transfers = await listActiveTransfers();

  if (transfers.length === 0) {
    heading("Transfers");
    log(dim("No active transfers."));
    console.log();
    return;
  }

  heading(`Transfers (${transfers.length} active)`);

  for (const t of transfers) {
    const remaining = formatDuration(t.remainingSeconds);
    const created = new Date(t.createdAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    log(
      `${cyan(t.id.padEnd(14))} ${t.title.padEnd(30)} ${dim(`${t.fileCount} files`).padEnd(22)} ${dim(created).padEnd(18)} ${yellow(remaining + " left")}`
    );
  }
  console.log();
}

async function cmdTransfersInfo(id: string) {
  const info = await getTransferInfo(id);
  if (!info) throw new Error(`Transfer "${id}" not found or expired.`);

  const remaining = formatDuration(info.remainingSeconds);

  heading(info.title);
  log(`${dim("ID:")}           ${info.id}`);
  log(`${dim("Files:")}        ${info.files.length}`);
  log(
    `${dim("Created:")}      ${new Date(info.createdAt).toLocaleString("en-GB")}`
  );
  log(
    `${dim("Expires:")}      ${new Date(info.expiresAt).toLocaleString("en-GB")} ${yellow(`(${remaining} left)`)}`
  );
  log(`${dim("Share URL:")}    ${green(`${BASE_URL}/t/${info.id}`)}`);
  log(
    `${dim("Admin URL:")}    ${green(`${BASE_URL}/t/${info.id}?token=${info.deleteToken}`)}`
  );
  console.log();

  if (info.files.length <= 30) {
    log(dim("Files:"));
    for (const f of info.files) {
      const dims = f.width && f.height ? dim(` ${f.width}×${f.height}`) : "";
      const size = formatBytes(f.size);
      log(`  ${f.filename.padEnd(35)} ${dim(f.kind.padEnd(8))} ${dim(size)}${dims}`);
    }
    console.log();
  }
}

async function cmdTransfersUpload(opts: {
  dir: string;
  title: string;
  expires?: string;
}) {
  heading(`Creating transfer: ${opts.title}`);

  const result = await createTransfer(opts, (msg) => progress(msg));

  console.log();
  log(green(`✓ ${result.transfer.files.length} files uploaded`));
  log(green(`✓ Transfer ${result.transfer.id} created`));

  const { fileCounts } = result;
  const countParts: string[] = [];
  if (fileCounts.images > 0) countParts.push(`${fileCounts.images} images`);
  if (fileCounts.gifs > 0) countParts.push(`${fileCounts.gifs} GIFs`);
  if (fileCounts.videos > 0) countParts.push(`${fileCounts.videos} videos`);
  if (fileCounts.audio > 0) countParts.push(`${fileCounts.audio} audio`);
  if (fileCounts.other > 0) countParts.push(`${fileCounts.other} other`);
  if (countParts.length > 0) log(dim(`  ${countParts.join(", ")}`));

  const expires = new Date(result.transfer.expiresAt);
  log(
    `${dim("Expires:")} ${expires.toLocaleString("en-GB")} ${yellow(`(${formatDuration(Math.floor((expires.getTime() - Date.now()) / 1000))} from now)`)}`
  );

  console.log();
  log(`${bold("Total uploaded:")} ${formatBytes(result.totalSize)}`);

  console.log();
  log(bold("Share this link:"));
  log(`  ${green(result.shareUrl)}`);
  console.log();
  log(bold("Admin link (takedown):"));
  log(`  ${yellow(result.adminUrl)}`);
  console.log();
}

async function cmdTransfersDelete(id: string) {
  const info = await getTransferInfo(id);
  if (!info) throw new Error(`Transfer "${id}" not found or already expired.`);

  heading(`Delete transfer: ${info.title}`);
  log(`${dim("Files:")} ${info.files.length}`);
  log(
    `${dim("Remaining:")} ${yellow(formatDuration(info.remainingSeconds))}`
  );
  console.log();

  const ok = await confirm(
    `${red("Permanently")} delete transfer "${id}" and all its R2 files?`
  );
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await deleteTransfer(id, (msg) => progress(msg));

  console.log();
  log(green(`✓ Deleted ${result.deletedFiles} files from R2`));
  log(green(`✓ Transfer metadata ${result.dataDeleted ? "removed" : "already expired"}`));
  console.log();
}

async function cmdTransfersNuke() {
  const transfers = await listActiveTransfers();

  heading("Nuke all transfers");
  log(`${dim("Active transfers:")} ${transfers.length}`);
  log(red("This will permanently delete ALL transfer files from R2"));
  log(red("and wipe ALL transfer metadata from Redis."));
  console.log();

  const ok = await confirm(
    `${red("PERMANENTLY")} wipe every transfer? This cannot be undone.`
  );
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await nukeAllTransfers((msg) => progress(msg));

  console.log();
  log(green(`✓ Deleted ${result.deletedFiles} files from R2`));
  log(green(`✓ Cleared ${result.deletedKeys} transfer keys from Redis`));
  log(dim("Clean slate."));
  console.log();
}

/* ─── Auth command handlers ─── */

async function cmdAuthListSessions(opts: { baseUrl?: string; adminToken: string }) {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");

  heading("Token sessions");
  log(`${dim("Base URL:")} ${baseUrl}`);
  console.log();

  const data = await listTokenSessions({ baseUrl, adminToken: opts.adminToken });
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  if (sessions.length === 0) {
    log(dim("No sessions found."));
    console.log();
    return;
  }

  log(dim(`Current token versions: admin=${data.currentTv.admin}, staff=${data.currentTv.staff}, upload=${data.currentTv.upload}`));
  console.log();

  const now = typeof data.now === "number" ? data.now : Math.floor(Date.now() / 1000);
  for (const s of sessions.slice(0, 60)) {
    const expiresIn = s.exp - now;
    const issuedAgo = now - s.iat;
    const jtiShort = s.jti.length > 18 ? `${s.jti.slice(0, 8)}…${s.jti.slice(-6)}` : s.jti;
    const ua = (s.ua ?? "").trim();
    const uaShort = ua ? (ua.length > 60 ? `${ua.slice(0, 60)}…` : ua) : "—";
    const ip = s.ip ?? "—";

    const status =
      s.status === "active"
        ? green("active")
        : s.status === "revoked"
          ? red("revoked")
          : s.status === "invalidated"
            ? yellow("invalidated")
            : dim("expired");

    log(
      `${cyan(s.role.padEnd(7))} ${status.padEnd(14)} ${dim(jtiShort.padEnd(20))} ${dim(`tv ${s.tv}`.padEnd(6))} ${dim(ip.padEnd(16))} ${dim(`exp ${formatDuration(expiresIn)}`.padEnd(18))} ${dim(`iat ${formatDuration(issuedAgo)} ago`.padEnd(22))} ${dim(uaShort)}`
    );
  }
  if (sessions.length > 60) {
    console.log();
    log(dim(`Showing first 60 of ${sessions.length}. Use filter/search in the admin dashboard for longer lists.`));
  }
  console.log();
}

async function cmdAuthRevoke(opts: {
  baseUrl?: string;
  role: RevokeRole;
  adminToken: string;
  adminPassword: string;
}) {
  const baseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const role = opts.role;

  heading("Revoke token sessions");
  log(`${dim("Base URL:")} ${baseUrl}`);
  log(`${dim("Scope:")}    ${role}`);
  console.log();

  progress("Requesting step-up token...");
  const stepUpData = await createStepUpToken({
    baseUrl,
    adminToken: opts.adminToken,
    adminPassword: opts.adminPassword,
  });

  progress("Revoking sessions...");
  const revokeData = await revokeRoleSessions({
    baseUrl,
    adminToken: opts.adminToken,
    stepUpToken: stepUpData.token,
    role,
  });

  const revoked = Array.isArray(revokeData.revoked)
    ? (revokeData.revoked as Array<{ role: string; tokenVersion: number }>)
    : [];
  console.log();
  if (revoked.length === 0) {
    log(green("✓ Sessions revoked."));
  } else {
    for (const item of revoked) {
      log(green(`✓ Revoked ${item.role} sessions (token version ${item.tokenVersion})`));
    }
  }
  console.log();
}

/* ─── Blog image command handlers ─── */

async function cmdBlogUpload(opts: { slug: string; dir: string; force?: boolean }) {
  heading(`Uploading blog images for "${opts.slug}"`);

  const result = await uploadBlogFiles(opts.slug, opts.dir, {
    force: opts.force,
    onProgress: (msg) => progress(msg),
  });

  console.log();

  // Summary
  if (result.uploaded.length > 0) {
    log(
      green(
        `✓ Uploaded ${result.uploaded.length} new image${result.uploaded.length > 1 ? "s" : ""}`
      )
    );
    const totalNew = result.uploaded.reduce((sum, r) => sum + r.size, 0);
    log(dim(`  New: ${formatBytes(totalNew)}`));
  }

  if (result.skipped.length > 0) {
    log(
      dim(
        `  Skipped ${result.skipped.length} (already in R2 — use --force to overwrite)`
      )
    );
  }

  if (result.uploaded.length === 0 && result.skipped.length > 0) {
    log(dim("Nothing new to upload."));
  }

  // Print NEW markdown snippets
  if (result.uploaded.length > 0) {
    console.log();
    log(bold("New markdown snippets:"));
    console.log();
    for (const r of result.uploaded) {
      const tag = r.overwrote ? dim(" (overwritten)") : "";
      log(`  ${r.markdown}${tag}`);
    }
  }

  // Print ALL images now in R2 (existing + new) so you have a full reference
  const allInR2 = await listBlogFiles(opts.slug);

  if (allInR2.length > 0) {
    console.log();
    log(bold(`All images for "${opts.slug}" (${allInR2.length} total):`));
    console.log();
    for (const img of allInR2) {
      const sanitised = img.filename.replace(/\.webp$/, "");
      log(`  ![${sanitised}](blog/${opts.slug}/${img.filename})  ${dim(formatBytes(img.size))}`);
    }
  }

  console.log();
  log(dim("Tip: change alt text for captions, e.g. ![the crowd goes wild](blog/...)"));
  console.log();
}

async function cmdBlogList(slug: string) {
  heading(`Blog images: ${slug}`);

  const files = await listBlogFiles(slug);
  if (files.length === 0) {
    log(dim("No files found for this post."));
    console.log();
    return;
  }

  for (const f of files) {
    const date = f.lastModified
      ? f.lastModified.toLocaleDateString()
      : "—";
    const label = f.filename.replace(/\.[^.]+$/, "");
    log(`  ${f.filename}  ${dim(formatBytes(f.size))}  ${dim(date)}`);
    // Show appropriate markdown snippet based on extension
    if (/\.webp$/i.test(f.filename)) {
      log(`  ${dim(`![${label}](blog/${slug}/${f.filename})`)}`);
    } else {
      log(`  ${dim(`[${label}](blog/${slug}/${f.filename})`)}`);
    }
    console.log();
  }
  log(
    dim(
      `${files.length} files · ${formatBytes(files.reduce((s, f) => s + f.size, 0))} total`
    )
  );
  console.log();
}

async function cmdBlogDelete(slug: string, filename?: string) {
  if (filename) {
    // Delete a single image
    heading(`Delete blog image: ${filename}`);
    const ok = await confirm(`Delete ${slug}/${filename} from R2?`);
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
    await deleteBlogFile(slug, filename, (msg) => progress(msg));
    log(green(`✓ Deleted ${filename}`));
    log(dim("Remember to remove the markdown reference from your post."));
    console.log();
  } else {
    // Delete ALL files for the post
    heading(`Delete all blog files for "${slug}"`);
    const files = await listBlogFiles(slug);
    log(`${dim("Files:")} ${files.length}`);
    log(red("This will delete ALL files for this post from R2."));
    console.log();

    const ok = await confirm(
      `Delete all ${files.length} files for "${slug}"?`
    );
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }

    const deleted = await deleteAllBlogFiles(slug, (msg) => progress(msg));
    log(green(`✓ Deleted ${deleted} files`));
    log(dim("Remember to remove image references from your post."));
    console.log();
  }
}

/* ─── Notes command handlers ─── */

const NOTE_VISIBILITIES = ["public", "unlisted", "private"] as const;
type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

function parseNoteVisibility(value?: string): NoteVisibility | undefined {
  if (!value) return undefined;
  return NOTE_VISIBILITIES.includes(value as NoteVisibility)
    ? (value as NoteVisibility)
    : undefined;
}

async function cmdNotesCreate(opts: {
  slug: string;
  title: string;
  markdown: string;
  subtitle?: string;
  visibility?: NoteVisibility;
}) {
  heading(`Create note: ${opts.slug}`);
  const created = await createNoteRecord({
    slug: opts.slug,
    title: opts.title,
    subtitle: opts.subtitle,
    visibility: opts.visibility ?? "private",
    markdown: opts.markdown,
  });
  log(green(`✓ Created ${created.meta.slug}`));
  log(dim(`visibility: ${created.meta.visibility}`));
  console.log();
}

async function cmdNotesUpload(opts: {
  slug: string;
  file: string;
  title?: string;
  subtitle?: string;
  visibility?: NoteVisibility;
}) {
  const abs = path.resolve(opts.file.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const markdown = fs.readFileSync(abs, "utf-8");

  const existing = await getNoteRecord(opts.slug);
  if (existing) {
    heading(`Update note from markdown file: ${opts.slug}`);
    const updated = await updateNoteRecord(opts.slug, {
      title: opts.title,
      subtitle: opts.subtitle,
      visibility: opts.visibility,
      markdown,
    });
    if (!updated) throw new Error("Failed to update note");
    log(green(`✓ Updated ${opts.slug} from ${abs}`));
    console.log();
    return;
  }

  heading(`Create note from markdown file: ${opts.slug}`);
  await createNoteRecord({
    slug: opts.slug,
    title: opts.title ?? opts.slug,
    subtitle: opts.subtitle,
    visibility: opts.visibility ?? "private",
    markdown,
  });
  log(green(`✓ Created ${opts.slug} from ${abs}`));
  console.log();
}

async function cmdNotesList(opts?: {
  visibility?: NoteVisibility;
  q?: string;
}) {
  heading("Notes");
  const { notes } = await listNoteRecords({
    includeNonPublic: true,
    visibility: opts?.visibility,
    q: opts?.q,
  });
  if (notes.length === 0) {
    log(dim("No notes found."));
    console.log();
    return;
  }

  for (const note of notes) {
    log(`${bold(note.slug)} ${dim(`(${note.visibility})`)}`);
    log(`  ${note.title}`);
    if (note.subtitle) log(`  ${dim(note.subtitle)}`);
    log(`  ${dim(new Date(note.updatedAt).toLocaleString())}`);
    console.log();
  }
}

async function cmdNotesUpdate(
  slug: string,
  opts: {
    title?: string;
    subtitle?: string | null;
    visibility?: NoteVisibility;
    markdownFile?: string;
  }
) {
  let markdown: string | undefined;
  if (opts.markdownFile) {
    const abs = path.resolve(opts.markdownFile.replace(/^~/, process.env.HOME ?? "~"));
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
    markdown = fs.readFileSync(abs, "utf-8");
  }

  heading(`Update note: ${slug}`);
  const updated = await updateNoteRecord(slug, {
    title: opts.title,
    subtitle: opts.subtitle,
    visibility: opts.visibility,
    markdown,
  });
  if (!updated) throw new Error(`Note "${slug}" not found`);
  log(green("✓ Note updated"));
  console.log();
}

async function cmdNotesDelete(slug: string) {
  heading(`Delete note: ${slug}`);
  const ok = await confirm(`Delete note "${slug}"?`);
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }
  const deleted = await deleteNoteRecord(slug);
  if (!deleted) throw new Error(`Note "${slug}" not found`);
  log(green("✓ Note deleted"));
  console.log();
}

async function cmdNotesShareCreate(opts: {
  slug: string;
  expiresInDays?: number;
  pinRequired?: boolean;
  pin?: string;
}) {
  heading(`Create note share: ${opts.slug}`);
  const created = await createNoteShare(opts.slug, {
    expiresInDays: opts.expiresInDays,
    pinRequired: opts.pinRequired,
    pin: opts.pin,
  });
  log(green("✓ Share link created"));
  log(`  ${created.url}`);
  console.log();
}

async function cmdNotesShareList(slug: string) {
  heading(`Note shares: ${slug}`);
  const links = await listNoteShares(slug);
  if (links.length === 0) {
    log(dim("No share links."));
    console.log();
    return;
  }
  for (const link of links) {
    const state = link.revokedAt ? "revoked" : "active";
    log(`${bold(link.id)} ${dim(`(${state})`)}`);
    log(`  expires: ${new Date(link.expiresAt).toLocaleString()}`);
    log(`  pin: ${link.pinRequired ? "required" : "off"}`);
    console.log();
  }
}

async function cmdNotesShareUpdate(
  slug: string,
  id: string,
  opts: { pinRequired?: boolean; pin?: string | null; expiresInDays?: number; rotateToken?: boolean }
) {
  heading(`Update share: ${id}`);
  const updated = await updateNoteShare(slug, id, opts);
  if (!updated) throw new Error("Share link not found.");
  log(green("✓ Share updated"));
  if (updated.url) {
    log("  New URL:");
    log(`  ${updated.url}`);
  }
  console.log();
}

async function cmdNotesShareRevoke(slug: string, id: string) {
  heading(`Revoke share: ${id}`);
  const ok = await confirm("Revoke this share link?");
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }
  const revoked = await revokeNoteShare(slug, id);
  if (!revoked) throw new Error("Share link not found.");
  log(green("✓ Share revoked"));
  console.log();
}

/* ─── Help ─── */

function showHelp() {
  console.log(`
  ${bold("milk & henny")} — Album, R2 & transfer management CLI

  ${bold("Usage")}
    pnpm cli                                  ${dim("Interactive mode (recommended)")}
    pnpm cli help                             ${dim("Show this help")}
    pnpm cli <command> [subcommand] [options] ${dim("Direct command")}

  ${bold("Albums")}
    albums list                              List all albums
    albums show ${dim("<slug>")}                       Show album details
    albums upload                            Upload new album
      --dir ${dim("<path>")}      ${dim("Folder with photos (e.g. ~/Desktop/party-photos)")}
      --slug ${dim("<slug>")}     ${dim("URL-safe name (e.g. jan-2026, summer-vibes)")}
      --title ${dim("<title>")}   ${dim("Display title (e.g. \"Milk & Henny — January 2026\")")}
      --date ${dim("<date>")}     ${dim("Date as YYYY-MM-DD (e.g. 2026-01-16)")}
      --description ${dim("<desc>")}  ${dim("Optional description")}
      --rotation ${dim("<portrait|landscape>")}  ${dim("Force orientation (default: trust EXIF)")}
    albums update ${dim("<slug>")} [options]            Update album metadata
      --title, --date, --description, --cover
    albums delete ${dim("<slug>")}                     Delete entire album + R2 files
    albums backfill-og ${dim("[--yes] [--force]")}     Backfill OG images for existing albums
      --yes            ${dim("Skip confirmation prompt")}
      --force          ${dim("Regenerate all (even existing og/) — use after changing focal points")}
      ${dim("Downloads originals from R2, generates 1200×630 JPGs, uploads to og/)")}
    albums validate                           Validate album JSON (focal presets, autoFocal 0–100)
      ${dim("Exits 1 if any album has invalid data. Use in CI.)")}

  ${bold("Photos")}
    photos list ${dim("<album>")}                      List photos with R2 keys
    photos add ${dim("<album>")} --dir ${dim("<path>")} ${dim("[--rotation portrait|landscape]")}
      ${dim("Add new photos. --rotation forces orientation for all photos.")}
    photos delete ${dim("<album> <photoId>")}          Remove a photo from album + R2
    photos set-cover ${dim("<album> <photoId>")}       Set album cover photo
    photos set-focal ${dim("<album> <photoId>")} --preset ${dim("<name>")}  Set crop focal point (manual)
      ${dim("Presets: c, t, b, l, r, tl, tr, bl, br, mt, mb, ml, mr")}
      ${dim("mt/mb/ml/mr = mid top/bottom/left/right (between edge and center)")}
      ${dim("Overrides auto-detected face position. Regenerates OG image.")}
    photos reset-focal ${dim("<album>")} ${dim("[photoId]")} ${dim("[--strategy onnx|sharp]")}
      ${dim("Clears manual override, re-detects faces, regenerates OG images.")}
      ${dim("Omit photoId to reset all photos in the album.")}
    photos compare-focal ${dim("<album> <photoId>")}    Compare detection strategies
      ${dim("Runs all strategies on a photo and shows the results side by side.")}

  ${bold("Transfers")} ${dim("(private, self-destructing file shares)")}
    transfers list                           List active transfers + time left
    transfers info ${dim("<id>")}                      Show transfer details + URLs
    transfers upload                         Upload new transfer
      --dir ${dim("<path>")}      ${dim("Folder with files (images, videos, PDFs, zips — anything)")}
      --title ${dim("<title>")}   ${dim('Title for the transfer (e.g. "Photos for John")')}
      --expires ${dim("<time>")}  ${dim("Expiry: 30m, 1h, 12h, 1d, 7d, 14d, 30d (default: 7d)")}
    transfers delete ${dim("<id>")}                    Take down a transfer + delete R2 files
    transfers nuke                           Wipe ALL transfers (R2 + Redis) — nuclear option

  ${bold("Blog Images")} ${dim("(images for blog posts, stored in R2)")}
    blog upload --slug ${dim("<post-slug>")} --dir ${dim("<path>")}  Upload images (skips duplicates)
      --force            ${dim("Re-upload and overwrite existing images")}
    blog list ${dim("<post-slug>")}                    List uploaded images + markdown snippets
    blog delete ${dim("<post-slug>")}                  Delete ALL images for a post
    blog delete ${dim("<post-slug>")} --file ${dim("<name>")}  Delete a single image

  ${bold("Notes")} ${dim("(private markdown + signed shares)")}
    notes create --slug ${dim("<slug>")} --title ${dim("<title>")} --markdown-file ${dim("<path>")} [--visibility public|unlisted|private] [--subtitle <text>]
    notes upload --slug ${dim("<slug>")} --file ${dim("<path>")} [--title <title>] [--subtitle <text>] [--visibility ...]
    notes list ${dim("[--visibility public|unlisted|private] [--q <query>]")}
    notes update ${dim("<slug>")} [--title <title>] [--subtitle <text>] [--visibility ...] [--markdown-file <path>]
    notes delete ${dim("<slug>")}
    notes share create ${dim("<slug>")} ${dim("[--expires-days 7] [--pin-required] [--pin 1234]")}
    notes share list ${dim("<slug>")}
    notes share update ${dim("<slug> <share-id>")} ${dim("[--pin-required true|false] [--pin <newPin>|--clear-pin] [--expires-days <n>] [--rotate-token]")}
    notes share revoke ${dim("<slug> <share-id>")}

  ${bold("Bucket")} ${dim("(raw R2 access)")}
    bucket ls ${dim("[prefix]")}                       Browse bucket contents
    bucket rm ${dim("<key>")}                          Delete a file from bucket
    bucket info                              Show bucket usage & free tier %

  ${bold("Auth")} ${dim("(session security)")}
    auth revoke --admin-token ${dim("<jwt>")} --admin-password ${dim("<password>")} ${dim("[--role admin|staff|upload|all] [--base-url http://localhost:3000]")}
      ${dim("Revokes token sessions by role. Requires admin JWT + step-up password.")}
    auth sessions --admin-token ${dim("<jwt>")} ${dim("[--base-url http://localhost:3000]")}
      ${dim("Lists active token sessions (Redis-backed) with status + expiry.")}

  ${bold("Examples")}
    ${dim("$")} pnpm cli
    ${dim("$")} pnpm cli albums upload --dir ~/Desktop/party --slug jan-2026 --title "January 2026" --date 2026-01-16
    ${dim("$")} pnpm cli transfers upload --dir ~/Desktop/send-photos --title "Photos for John" --expires 7d
    ${dim("$")} pnpm cli transfers list
    ${dim("$")} pnpm cli transfers delete abc12345
    ${dim("$")} pnpm cli blog upload --slug my-first-birthday --dir ~/Desktop/blog-photos
    ${dim("$")} pnpm cli blog list my-first-birthday
    ${dim("$")} pnpm cli photos delete jan-2026 DSC00003
    ${dim("$")} pnpm cli bucket ls blog/my-first-birthday/
`);
}

/* ─── Interactive mode ─── */

/** Safely run an async operation, catch and display errors without exiting */
async function safely(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.log();
    log(red(`Error: ${(err as Error).message}`));
    console.log();
  }
}

/** Interactive prompt for uploading a new album with full validation */
async function promptUpload(): Promise<void> {
  console.log();
  log(bold("Upload new album"));
  log(
    dim(
      "This will process images from a folder on your Mac, upload them to R2,"
    )
  );
  log(dim("and create the album JSON in content/albums/."));
  console.log();

  /* Source directory */
  let dir = "";
  while (true) {
    dir = await ask("Source directory", {
      hint: "e.g. ~/Desktop/party-photos",
    });
    if (!dir) return;

    const check = validateDir(dir);
    if (check.valid) {
      log(green(`  Found ${check.count} images`));
      break;
    }
    log(red(`  ${check.error}`));
  }

  /* Slug */
  let slug = "";
  while (true) {
    slug = await ask("Album slug", {
      hint: "URL-safe name, e.g. jan-2026 or summer-vibes",
    });
    if (!slug) return;

    if (!isValidSlug(slug)) {
      log(red("  Slug must be lowercase letters, numbers, and hyphens only."));
      log(dim("  Examples: jan-2026, summer-vibes, milk-and-henny-feb"));
      continue;
    }

    /* Check if album already exists */
    if (getAlbum(slug)) {
      log(
        yellow(
          `  Album "${slug}" already exists. Use a different slug, or add photos with Photos → Add.`
        )
      );
      continue;
    }

    break;
  }

  /* Title */
  const title = await ask("Album title", {
    hint: 'e.g. "Milk & Henny — January 2026"',
  });
  if (!title) return;

  /* Date */
  let date = "";
  while (true) {
    date = await ask("Date", { hint: "YYYY-MM-DD, e.g. 2026-01-16" });
    if (!date) return;

    if (!isValidDate(date)) {
      log(red("  Invalid date. Use YYYY-MM-DD format."));
      continue;
    }
    break;
  }

  /* Description (optional) */
  const description = await ask("Description", { hint: "optional, press enter to skip" });

  /* Optional rotation override */
  const rotChoice = await choose("Rotation override (optional)", [
    { label: "None", detail: "trust EXIF orientation (default)" },
    { label: "Portrait", detail: "force all photos to portrait" },
    { label: "Landscape", detail: "force all photos to landscape" },
  ]);
  const rotation: RotationOverride | undefined =
    rotChoice === 2 ? "portrait" : rotChoice === 3 ? "landscape" : undefined;

  /* Confirm */
  console.log();
  log(dim("─── Summary ───"));
  log(`${dim("Directory:")}   ${dir}`);
  log(`${dim("Slug:")}        ${slug}`);
  log(`${dim("Title:")}       ${title}`);
  log(`${dim("Date:")}        ${date}`);
  if (description) log(`${dim("Description:")} ${description}`);
  if (rotation) log(`${dim("Rotation:")}    ${rotation}`);
  console.log();

  const ok = await confirm("Upload this album?");
  if (!ok) {
    log(dim("Cancelled."));
    return;
  }

  await cmdAlbumsUpload({
    dir: dir.replace(/^~/, process.env.HOME ?? "~"),
    slug,
    title,
    date,
    description: description || undefined,
    rotation,
  });
}

/** Interactive prompt for updating album metadata */
async function promptUpdate(): Promise<void> {
  const slug = await selectAlbum();
  if (!slug) return;

  const album = getAlbum(slug);
  if (!album) return;

  console.log();
  log(dim("Leave blank to keep current value."));
  console.log();

  const title = await ask("Title", { defaultVal: album.title });
  const date = await ask("Date", {
    defaultVal: album.date,
    hint: "YYYY-MM-DD",
  });
  const description = await ask("Description", {
    defaultVal: album.description ?? "",
    hint: "leave empty to clear",
  });

  /* Cover — show current and offer to change via photo picker */
  let newCover: string | undefined;
  const changeCover = await confirm(
    `Current cover: ${bold(album.cover)}. Change it?`
  );
  if (changeCover) {
    console.log();
    const picked = await selectPhoto(slug);
    if (picked && picked !== album.cover) {
      newCover = picked;
    } else if (picked === album.cover) {
      log(dim("Same as current cover — no change."));
    }
  }

  /* Only send changes */
  const updates: Record<string, string | undefined> = {};
  if (title !== album.title) updates.title = title;
  if (date !== album.date) {
    if (!isValidDate(date)) {
      log(red("Invalid date format. No changes made."));
      return;
    }
    updates.date = date;
  }
  if (description !== (album.description ?? ""))
    updates.description = description;
  if (newCover) updates.cover = newCover;

  if (Object.keys(updates).length === 0) {
    log(dim("No changes."));
    return;
  }

  await cmdAlbumsUpdate(slug, updates);
}

/** Interactive prompt for adding photos to an existing album */
async function promptAddPhotos(): Promise<void> {
  const slug = await selectAlbum();
  if (!slug) return;

  console.log();
  let dir = "";
  while (true) {
    dir = await ask("Directory with new photos", {
      hint: "e.g. ~/Desktop/more-photos",
    });
    if (!dir) return;

    const check = validateDir(dir);
    if (check.valid) {
      log(green(`  Found ${check.count} images`));
      break;
    }
    log(red(`  ${check.error}`));
  }

  const rotChoice = await choose("Rotation override (optional)", [
    { label: "None", detail: "trust EXIF orientation (default)" },
    { label: "Portrait", detail: "force all photos to portrait" },
    { label: "Landscape", detail: "force all photos to landscape" },
  ]);
  const rotation: RotationOverride | undefined =
    rotChoice === 2 ? "portrait" : rotChoice === 3 ? "landscape" : undefined;

  await cmdPhotosAdd(slug, dir.replace(/^~/, process.env.HOME ?? "~"), rotation);
}

async function interactiveAlbums() {
  while (true) {
    const choice = await choose("Albums", [
      { label: "List albums", detail: "see all albums at a glance" },
      { label: "Show album details", detail: "photos, metadata, cover" },
      { label: "Upload new album", detail: "process images and upload to R2" },
      { label: "Update album metadata", detail: "change title, date, description" },
      { label: "Delete album", detail: "remove from R2 and JSON" },
      { label: "Backfill OG images", detail: "generate og/ variants for existing albums" },
      { label: "Validate album JSON", detail: "check focal presets and autoFocal ranges" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1:
        await safely(cmdAlbumsList);
        await pause();
        break;
      case 2: {
        const slug = await selectAlbum();
        if (slug) {
          await safely(() => cmdAlbumsShow(slug));
          await pause();
        }
        break;
      }
      case 3:
        await safely(promptUpload);
        await pause();
        break;
      case 4:
        await safely(promptUpdate);
        await pause();
        break;
      case 5: {
        const slug = await selectAlbum();
        if (slug) {
          await safely(() => cmdAlbumsDelete(slug));
          await pause();
        }
        break;
      }
      case 6: {
        const strategy = await selectStrategy();
        await safely(() => cmdAlbumsBackfillOg(false, true, strategy));
        await pause();
        break;
      }
      case 7:
        await safely(cmdAlbumsValidate);
        await pause();
        break;
    }
  }
}

/** Prompt for detection strategy (onnx or sharp) */
async function selectStrategy(): Promise<DetectionStrategy> {
  const choice = await choose("Detection strategy", [
    { label: "onnx", detail: "UltraFace neural network — true face detection (default)" },
    { label: "sharp", detail: "Sharp attention saliency — skin tones + luminance, no model" },
  ]);
  return choice <= 0 ? "onnx" : (["onnx", "sharp"] as const)[choice - 1];
}

async function interactivePhotos() {
  while (true) {
    const choice = await choose("Photos", [
      { label: "List photos in album", detail: "IDs, dimensions, R2 keys" },
      { label: "Add photos to album", detail: "upload from a folder" },
      { label: "Delete a photo", detail: "remove from R2 and JSON" },
      { label: "Set cover photo", detail: "change album thumbnail" },
      { label: "Set focal point", detail: "manual crop position for OG + embeds" },
      { label: "Reset focal point", detail: "clear manual, re-detect faces, regen OG" },
      { label: "Compare strategies", detail: "run onnx + sharp on a photo side by side" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1: {
        const slug = await selectAlbum();
        if (slug) {
          await safely(() => cmdPhotosList(slug));
          await pause();
        }
        break;
      }
      case 2:
        await safely(promptAddPhotos);
        await pause();
        break;
      case 3: {
        const slug = await selectAlbum();
        if (!slug) break;
        const photoId = await selectPhoto(slug);
        if (!photoId) break;
        await safely(() => cmdPhotosDelete(slug, photoId));
        await pause();
        break;
      }
      case 4: {
        const slug = await selectAlbum();
        if (!slug) break;
        const photoId = await selectPhoto(slug);
        if (!photoId) break;
        await safely(() => cmdPhotosSetCover(slug, photoId));
        await pause();
        break;
      }
      case 5: {
        const slug = await selectAlbum();
        if (!slug) break;
        const photoId = await selectPhoto(slug);
        if (!photoId) break;

        const presetChoice = await choose(
          "Focal point (where to center the crop)",
          [
            { label: "Center", detail: "default, good for most landscape shots" },
            { label: "Top", detail: "face at top edge" },
            { label: "Bottom", detail: "subject at bottom edge" },
            { label: "Left", detail: "subject at left edge" },
            { label: "Right", detail: "subject at right edge" },
            { label: "Top left", detail: "subject in top-left corner" },
            { label: "Top right", detail: "subject in top-right corner" },
            { label: "Bottom left", detail: "subject in bottom-left corner" },
            { label: "Bottom right", detail: "subject in bottom-right corner" },
            { label: "Mid top", detail: "between top and center — upper third" },
            { label: "Mid bottom", detail: "between bottom and center — lower third" },
            { label: "Mid left", detail: "between left and center — left third" },
            { label: "Mid right", detail: "between right and center — right third" },
          ]
        );
        if (presetChoice <= 0) break;

        const preset = FOCAL_PRESETS[presetChoice - 1];
        await safely(() => cmdPhotosSetFocal(slug, photoId, preset));
        await pause();
        break;
      }
      case 6: {
        const slug = await selectAlbum();
        if (!slug) break;
        const resetScope = await choose("Reset scope", [
          { label: "All photos in album", detail: "re-detect + regen OG for every photo" },
          { label: "Single photo", detail: "pick one photo to reset" },
        ]);
        if (resetScope <= 0) break;

        const photoId = resetScope === 2 ? (await selectPhoto(slug)) ?? undefined : undefined;
        if (resetScope === 2 && !photoId) break;

        const strategy = await selectStrategy();
        await safely(() => cmdPhotosResetFocal(slug, photoId, strategy));
        await pause();
        break;
      }
      case 7: {
        const slug = await selectAlbum();
        if (!slug) break;
        const photoId = await selectPhoto(slug);
        if (!photoId) break;
        await safely(() => cmdPhotosCompareFocal(slug, photoId));
        await pause();
        break;
      }
    }
  }
}

async function interactiveBucket() {
  while (true) {
    const choice = await choose("Bucket", [
      { label: "Browse bucket", detail: "navigate folders in R2" },
      { label: "Delete a file", detail: "raw R2 delete (use photos delete for albums)" },
      { label: "Bucket info", detail: "storage usage and free tier %" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1: {
        let prefix = "";
        while (true) {
          await safely(() => cmdBucketLs(prefix));

          const next = await ask("Navigate", {
            hint: `type a folder name to enter, ${dim("'back'")} to go up, ${dim("'done'")} to stop`,
          });

          if (next === "done" || next === "") break;
          if (next === "back") {
            const parts = prefix.replace(/\/$/, "").split("/");
            parts.pop();
            prefix = parts.length > 0 ? parts.join("/") + "/" : "";
          } else {
            /* Allow entering relative or absolute paths */
            if (next.startsWith("albums/")) {
              prefix = next.endsWith("/") ? next : next + "/";
            } else {
              prefix = prefix + (next.endsWith("/") ? next : next + "/");
            }
          }
        }
        break;
      }
      case 2: {
        console.log();
        log(dim("Tip: Use 'Browse bucket' first to find the key you want to delete."));
        const key = await ask("Full key to delete", {
          hint: "e.g. albums/jan-2026/thumb/DSC00003.webp",
        });
        if (!key) break;
        await safely(() => cmdBucketRm(key));
        await pause();
        break;
      }
      case 3:
        await safely(cmdBucketInfo);
        await pause();
        break;
    }
  }
}

/* ─── Interactive: Transfers ─── */

/** Interactive prompt for creating a new transfer */
async function promptTransferUpload(): Promise<void> {
  console.log();
  log(bold("Create private transfer"));
  log(
    dim("Upload any files to a self-destructing shareable link.")
  );
  log(dim("Images, videos, GIFs, PDFs, zips — anything goes."));
  console.log();

  /* Source directory */
  let dir = "";
  while (true) {
    dir = await ask("Source directory", {
      hint: "e.g. ~/Desktop/files-for-john",
    });
    if (!dir) return;

    const check = validateTransferDir(dir);
    if (check.valid) {
      log(green(`  Found ${check.count} files`));
      break;
    }
    log(red(`  ${check.error}`));
  }

  /* Title */
  const title = await ask("Transfer title", {
    hint: 'e.g. "Photos for John" or "Event recap"',
  });
  if (!title) return;

  /* Expiry */
  const expiresInput = await ask("Expires in", {
    hint: "30m, 1h, 12h, 1d, 7d, 14d, 30d",
    defaultVal: "7d",
  });

  // Validate expiry before confirming
  try {
    parseExpiry(expiresInput);
  } catch (err) {
    log(red(`  ${(err as Error).message}`));
    return;
  }

  /* Confirm */
  console.log();
  log(dim("─── Summary ───"));
  log(`${dim("Directory:")} ${dir}`);
  log(`${dim("Title:")}     ${title}`);
  log(`${dim("Expires:")}   ${expiresInput}`);
  console.log();

  const ok = await confirm("Create this transfer?");
  if (!ok) {
    log(dim("Cancelled."));
    return;
  }

  await cmdTransfersUpload({
    dir: dir.replace(/^~/, process.env.HOME ?? "~"),
    title,
    expires: expiresInput,
  });
}

/** Select a transfer from the active list. Returns transfer ID or null. */
async function selectTransfer(): Promise<string | null> {
  const transfers = await listActiveTransfers();
  if (transfers.length === 0) {
    console.log();
    log(dim("No active transfers."));
    return null;
  }

  const choice = await choose(
    "Select transfer",
    transfers.map((t) => ({
      label: t.title,
      detail: `${t.id} · ${t.fileCount} files · ${yellow(formatDuration(t.remainingSeconds) + " left")}`,
    }))
  );

  if (choice <= 0) return null;
  return transfers[choice - 1].id;
}

async function interactiveTransfers() {
  while (true) {
    const choice = await choose("Transfers", [
      { label: "List active transfers", detail: "see all + time remaining" },
      { label: "Transfer details", detail: "URLs, photos, expiry" },
      { label: "Create new transfer", detail: "upload files to shareable link" },
      { label: "Delete a transfer", detail: "take down and remove from R2" },
      { label: "Nuke all transfers", detail: "wipe everything — nuclear option" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1:
        await safely(cmdTransfersList);
        await pause();
        break;
      case 2: {
        const id = await selectTransfer();
        if (id) {
          await safely(() => cmdTransfersInfo(id));
          await pause();
        }
        break;
      }
      case 3:
        await safely(promptTransferUpload);
        await pause();
        break;
      case 4: {
        const id = await selectTransfer();
        if (id) {
          await safely(() => cmdTransfersDelete(id));
          await pause();
        }
        break;
      }
      case 5:
        await safely(cmdTransfersNuke);
        await pause();
        break;
    }
  }
}

/* ─── Interactive blog images ─── */

/** Interactive prompt for selecting a post slug — shows existing posts */
async function selectPostSlug(prompt = "Post slug"): Promise<string | null> {
  const slugs = getPostSlugs();

  if (slugs.length > 0) {
    console.log();
    log(dim("Existing posts:"));
    for (const s of slugs) {
      log(`  ${dim("·")} ${s}`);
    }
    console.log();
  }

  while (true) {
    const slug = await ask(prompt, {
      hint: slugs.length > 0
        ? "pick from above or type a new slug"
        : "e.g. my-first-birthday (must match your .md filename)",
    });
    if (!slug) return null;
    if (!isValidSlug(slug)) {
      log(red("  Slug must be lowercase letters, numbers, hyphens only."));
      continue;
    }

    // Warn if slug doesn't match any existing post
    if (!slugs.includes(slug)) {
      log(
        yellow(
          `  No .md file found for "${slug}" in content/posts/ — files will upload but won't render until you create the post.`
        )
      );
    }
    return slug;
  }
}

/** Interactive prompt for uploading blog files */
async function promptBlogUpload(): Promise<void> {
  console.log();
  log(bold("Upload blog files"));
  log(dim("Process and upload files from a folder to R2, get markdown snippets."));
  log(dim("Images → WebP. Videos, PDFs, etc. → uploaded as-is."));
  log(dim("Duplicates are skipped automatically — safe to re-run with new files."));
  console.log();

  /* Post slug */
  const slug = await selectPostSlug();
  if (!slug) return;

  /* Source directory */
  let dir = "";
  while (true) {
    dir = await ask("Source directory", {
      hint: "e.g. ~/Desktop/blog-photos",
    });
    if (!dir) return;

    const check = validateAnyDir(dir);
    if (check.valid) {
      log(green(`  Found ${check.count} files`));
      break;
    }
    log(red(`  ${check.error}`));
  }

  /* Confirm */
  console.log();
  log(dim("─── Summary ───"));
  log(`${dim("Post slug:")}  ${slug}`);
  log(`${dim("Directory:")}  ${dir}`);
  console.log();

  const ok = await confirm("Upload these images?");
  if (!ok) {
    log(dim("Cancelled."));
    return;
  }

  await cmdBlogUpload({ slug, dir: dir.replace(/^~/, process.env.HOME ?? "~") });
}

/** Select a blog post slug from those that have files uploaded in R2 */
async function selectBlogSlug(): Promise<string | null> {
  const objects = await listObjects("blog/");
  const slugs = new Set<string>();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    if (parts.length >= 3 && parts[1]) {
      slugs.add(parts[1]);
    }
  }

  if (slugs.size === 0) {
    console.log();
    log(dim("No blog files found in R2. Upload some first."));
    return null;
  }

  const slugList = [...slugs].sort();
  const choice = await choose(
    "Select post",
    slugList.map((s) => ({ label: s }))
  );

  if (choice <= 0) return null;
  return slugList[choice - 1];
}

async function interactiveBlogImages() {
  while (true) {
    const choice = await choose("Blog Images", [
      { label: "Upload images", detail: "process + upload for a blog post" },
      { label: "List images", detail: "see what's uploaded for a post" },
      { label: "Delete image(s)", detail: "remove one or all images for a post" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1:
        await safely(promptBlogUpload);
        await pause();
        break;
      case 2: {
        const slug = await selectBlogSlug();
        if (slug) {
          await safely(() => cmdBlogList(slug));
          await pause();
        }
        break;
      }
      case 3: {
        const slug = await selectBlogSlug();
        if (slug) {
          // Ask: delete one or all?
          const files = await listBlogFiles(slug);
          if (files.length === 0) {
            log(dim("No files found."));
            break;
          }

          const what = await choose(`Delete from "${slug}"`, [
            { label: "Delete a specific file" },
            { label: "Delete ALL files for this post", detail: red("destructive") },
          ]);

          if (what === 1) {
            const fileChoice = await choose(
              "Select file",
              files.map((f) => ({
                label: f.filename,
                detail: formatBytes(f.size),
              }))
            );
            if (fileChoice > 0) {
              await safely(() =>
                cmdBlogDelete(slug, files[fileChoice - 1].filename)
              );
            }
          } else if (what === 2) {
            await safely(() => cmdBlogDelete(slug));
          }
          await pause();
        }
        break;
      }
    }
  }
}

/* ─── Interactive: Notes ─── */

async function selectNoteSlug(promptText = "Note slug"): Promise<string | null> {
  const { notes } = await listNoteRecords({ includeNonPublic: true });
  if (notes.length > 0) {
    console.log();
    log(dim("Existing notes:"));
    for (const note of notes.slice(0, 30)) {
      log(`  ${dim("·")} ${note.slug} ${dim(`(${note.visibility})`)}`);
    }
    console.log();
  }

  while (true) {
    const slug = await ask(promptText, { hint: "lowercase letters, numbers, hyphens" });
    if (!slug) return null;
    if (!isValidSlug(slug)) {
      log(red("  Invalid slug format."));
      continue;
    }
    return slug;
  }
}

async function interactiveNotes() {
  while (true) {
    const choice = await choose("Notes", [
      { label: "Create note", detail: "new markdown note" },
      { label: "Upload markdown file", detail: "create or replace note body from a local file" },
      { label: "List notes", detail: "show notes and visibility" },
      { label: "Update note", detail: "title/subtitle/visibility/markdown file" },
      { label: "Delete note", detail: "remove a note permanently" },
      { label: "Create share link", detail: "signed URL, optional PIN" },
      { label: "List share links", detail: "show active/revoked shares for a note" },
      { label: "Update share link", detail: "toggle PIN, rotate token, extend expiry" },
      { label: "Revoke share link", detail: "disable a share URL" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1: {
        const slug = await selectNoteSlug("New note slug");
        if (!slug) break;
        const title = await ask("Title");
        if (!title) break;
        const markdownFile = await ask("Markdown file", { hint: "e.g. ~/Desktop/note.md" });
        if (!markdownFile) break;
        const subtitle = await ask("Subtitle (optional)");
        const visChoice = await choose("Visibility", [
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        if (visChoice <= 0) break;
        const visibility = (["private", "unlisted", "public"] as const)[visChoice - 1];
        await safely(() =>
          cmdNotesUpload({
            slug,
            file: markdownFile,
            title,
            subtitle: subtitle || undefined,
            visibility,
          })
        );
        await pause();
        break;
      }
      case 2: {
        const slug = await selectNoteSlug();
        if (!slug) break;
        const file = await ask("Markdown file path");
        if (!file) break;
        const title = await ask("Title override (optional)");
        const subtitle = await ask("Subtitle override (optional)");
        const visChoice = await choose("Visibility override", [
          { label: "keep existing" },
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        const visibility =
          visChoice <= 1 ? undefined : (["private", "unlisted", "public"] as const)[visChoice - 2];
        await safely(() =>
          cmdNotesUpload({
            slug,
            file,
            title: title || undefined,
            subtitle: subtitle || undefined,
            visibility,
          })
        );
        await pause();
        break;
      }
      case 3:
        await safely(() => cmdNotesList());
        await pause();
        break;
      case 4: {
        const slug = await selectNoteSlug();
        if (!slug) break;
        const title = await ask("New title (blank = keep)");
        const subtitle = await ask("New subtitle (blank = keep, --clear not supported here)");
        const markdownFile = await ask("New markdown file (blank = keep)");
        const visChoice = await choose("Visibility", [
          { label: "keep existing" },
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        const visibility =
          visChoice <= 1 ? undefined : (["private", "unlisted", "public"] as const)[visChoice - 2];
        await safely(() =>
          cmdNotesUpdate(slug, {
            title: title || undefined,
            subtitle: subtitle || undefined,
            markdownFile: markdownFile || undefined,
            visibility,
          })
        );
        await pause();
        break;
      }
      case 5: {
        const slug = await selectNoteSlug();
        if (slug) {
          await safely(() => cmdNotesDelete(slug));
          await pause();
        }
        break;
      }
      case 6: {
        const slug = await selectNoteSlug();
        if (!slug) break;
        const withPin = await confirm("Require PIN on this share link?");
        const pin = withPin ? await ask("PIN") : "";
        await safely(() =>
          cmdNotesShareCreate({
            slug,
            pinRequired: withPin,
            pin: withPin ? pin : undefined,
            expiresInDays: 7,
          })
        );
        await pause();
        break;
      }
      case 7: {
        const slug = await selectNoteSlug();
        if (slug) {
          await safely(() => cmdNotesShareList(slug));
          await pause();
        }
        break;
      }
      case 8: {
        const slug = await selectNoteSlug();
        if (!slug) break;
        const links = await listNoteShares(slug);
        if (links.length === 0) {
          log(dim("No share links."));
          await pause();
          break;
        }
        const pick = await choose(
          "Select share",
          links.map((l) => ({
            label: l.id,
            detail: `${l.pinRequired ? "pin on" : "pin off"} · expires ${new Date(l.expiresAt).toLocaleDateString()}`,
          }))
        );
        if (pick <= 0) break;
        const link = links[pick - 1];
        const action = await choose("Update action", [
          { label: "Toggle PIN requirement" },
          { label: "Set/Change PIN" },
          { label: "Clear PIN" },
          { label: "Rotate token" },
          { label: "Extend expiry (days)" },
        ]);
        if (action <= 0) break;

        if (action === 1) {
          const nextPin = link.pinRequired ? undefined : await ask("PIN");
          await safely(() =>
            cmdNotesShareUpdate(slug, link.id, {
              pinRequired: !link.pinRequired,
              ...(link.pinRequired ? {} : { pin: nextPin || undefined }),
            })
          );
        } else if (action === 2) {
          const pin = await ask("New PIN");
          if (pin) await safely(() => cmdNotesShareUpdate(slug, link.id, { pinRequired: true, pin }));
        } else if (action === 3) {
          await safely(() => cmdNotesShareUpdate(slug, link.id, { pin: null }));
        } else if (action === 4) {
          await safely(() => cmdNotesShareUpdate(slug, link.id, { rotateToken: true }));
        } else if (action === 5) {
          const daysRaw = await ask("Days", { defaultVal: "7" });
          const days = parseInt(daysRaw, 10);
          if (Number.isFinite(days) && days > 0) {
            await safely(() => cmdNotesShareUpdate(slug, link.id, { expiresInDays: days }));
          }
        }
        await pause();
        break;
      }
      case 9: {
        const slug = await selectNoteSlug();
        if (!slug) break;
        const links = await listNoteShares(slug);
        if (links.length === 0) {
          log(dim("No share links."));
          await pause();
          break;
        }
        const pick = await choose("Revoke which share?", links.map((l) => ({ label: l.id })));
        if (pick > 0) {
          await safely(() => cmdNotesShareRevoke(slug, links[pick - 1].id));
          await pause();
        }
        break;
      }
    }
  }
}

async function interactive() {
  console.log();
  log(bold("milk & henny") + dim(" — interactive CLI"));
  log(dim("Navigate with numbers. Press 0 to go back. Ctrl+C to quit."));

  while (true) {
    const choice = await choose("What would you like to do?", [
      { label: "Albums", detail: "list, upload, update, delete albums" },
      { label: "Photos", detail: "list, add, delete, set cover photo" },
      { label: "Transfers", detail: "private, self-destructing file shares" },
      { label: "Blog Images", detail: "upload, list, delete images for blog posts" },
      { label: "Notes", detail: "private markdown and signed links" },
      { label: "Bucket", detail: "browse R2, delete files, usage stats" },
      { label: "Auth", detail: "list/revoke token sessions (admin)" },
    ]);

    switch (choice) {
      case 0:
        console.log();
        log(dim("Goodbye."));
        console.log();
        return;
      case 1:
        await interactiveAlbums();
        break;
      case 2:
        await interactivePhotos();
        break;
      case 3:
        await interactiveTransfers();
        break;
      case 4:
        await interactiveBlogImages();
        break;
      case 5:
        await interactiveNotes();
        break;
      case 6:
        await interactiveBucket();
        break;
      case 7:
        await interactiveAuth();
        break;
    }
  }
}

/* ─── Interactive: Auth ─── */

async function promptAdminToken(): Promise<string | null> {
  console.log();
  log(dim("Tip: get your admin JWT from the Admin dashboard (sessionStorage) or your own notes."));
  const token = await ask("Admin JWT", { hint: "paste the Bearer token (no 'Bearer ' prefix)" });
  return token ? token.trim() : null;
}

async function promptBaseUrl(): Promise<string> {
  const defaultVal = BASE_URL || "http://localhost:3000";
  const baseUrl = await ask("Base URL", {
    hint: "where the app is running",
    defaultVal,
  });
  return normalizeBaseUrl(baseUrl || defaultVal);
}

async function interactiveAuth() {
  while (true) {
    const choice = await choose("Auth", [
      { label: "List token sessions", detail: "see active/revoked/expired tokens (Redis-backed)" },
      { label: "Revoke admin sessions", detail: red("destructive (logs out all admins)") },
      { label: "Revoke all role sessions", detail: red("destructive (staff + upload + admin)") },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1: {
        const baseUrl = await promptBaseUrl();
        const token = await promptAdminToken();
        if (!token) break;
        await safely(() => cmdAuthListSessions({ baseUrl, adminToken: token }));
        await pause();
        break;
      }
      case 2: {
        const baseUrl = await promptBaseUrl();
        const token = await promptAdminToken();
        if (!token) break;
        const password = await ask("Admin password", { hint: "step-up confirmation (input visible)" });
        if (!password) break;
        await safely(() =>
          cmdAuthRevoke({
            baseUrl,
            adminToken: token,
            adminPassword: password,
            role: "admin",
          })
        );
        await pause();
        break;
      }
      case 3: {
        const baseUrl = await promptBaseUrl();
        const token = await promptAdminToken();
        if (!token) break;
        const password = await ask("Admin password", { hint: "step-up confirmation (input visible)" });
        if (!password) break;
        await safely(() =>
          cmdAuthRevoke({
            baseUrl,
            adminToken: token,
            adminPassword: password,
            role: "all",
          })
        );
        await pause();
        break;
      }
    }
  }
}

/* ─── Direct mode router ─── */

async function direct() {
  const command = args[0];
  const subcommand = args[1];

  try {
    switch (command) {
      case "albums":
        switch (subcommand) {
          case "list":
            return cmdAlbumsList();
          case "show": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli albums show <slug>");
            return cmdAlbumsShow(slug);
          }
          case "upload": {
            const dir = getArg("dir");
            const slug = getArg("slug");
            const title = getArg("title");
            const date = getArg("date");
            const description = getArg("description");
            const rotationArg = getArg("rotation") as RotationOverride | undefined;
            if (!dir || !slug || !title || !date) {
              throw new Error(
                "Usage: pnpm cli albums upload --dir <path> --slug <slug> --title <title> --date <YYYY-MM-DD> [--description <desc>] [--rotation portrait|landscape]"
              );
            }
            if (rotationArg && !ROTATION_OVERRIDES.includes(rotationArg)) {
              throw new Error(`Invalid rotation. Use: ${ROTATION_OVERRIDES.join(", ")}`);
            }
            if (!isValidSlug(slug)) throw new Error("Slug must be lowercase letters, numbers, hyphens only.");
            if (!isValidDate(date)) throw new Error("Date must be YYYY-MM-DD format.");
            return cmdAlbumsUpload({ dir, slug, title, date, description, rotation: rotationArg });
          }
          case "update": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli albums update <slug> [--title ...] [--date ...] ...");
            const title = getArg("title");
            const date = getArg("date");
            const description = getArg("description");
            const cover = getArg("cover");
            if (!title && !date && !description && !cover) {
              throw new Error("Nothing to update. Pass --title, --date, --description, or --cover.");
            }
            if (date && !isValidDate(date)) throw new Error("Date must be YYYY-MM-DD format.");
            return cmdAlbumsUpdate(slug, { title, date, description, cover });
          }
          case "delete": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli albums delete <slug>");
            return cmdAlbumsDelete(slug);
          }
          case "backfill-og": {
            const hasYes = args.includes("--yes");
            const hasForce = args.includes("--force");
            const strategyArg = getArg("strategy") as DetectionStrategy | undefined;
            if (strategyArg && !DETECTION_STRATEGIES.includes(strategyArg)) {
              throw new Error(`Invalid strategy. Use: ${DETECTION_STRATEGIES.join(", ")}`);
            }
            return cmdAlbumsBackfillOg(hasYes, hasForce, strategyArg);
          }
          case "validate":
            return cmdAlbumsValidate();
          default:
            throw new Error(`Unknown: albums ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "photos":
        switch (subcommand) {
          case "list": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli photos list <album-slug>");
            return cmdPhotosList(slug);
          }
          case "add": {
            const slug = args[2];
            const dir = getArg("dir");
            const rotationArg = getArg("rotation") as RotationOverride | undefined;
            if (!slug || !dir) throw new Error("Usage: pnpm cli photos add <album-slug> --dir <path> [--rotation portrait|landscape]");
            if (rotationArg && !ROTATION_OVERRIDES.includes(rotationArg)) {
              throw new Error(`Invalid rotation. Use: ${ROTATION_OVERRIDES.join(", ")}`);
            }
            return cmdPhotosAdd(slug, dir, rotationArg);
          }
          case "delete": {
            const slug = args[2];
            const photoId = args[3];
            if (!slug || !photoId) throw new Error("Usage: pnpm cli photos delete <album-slug> <photo-id>");
            return cmdPhotosDelete(slug, photoId);
          }
          case "set-cover": {
            const slug = args[2];
            const photoId = args[3];
            if (!slug || !photoId) throw new Error("Usage: pnpm cli photos set-cover <album-slug> <photo-id>");
            return cmdPhotosSetCover(slug, photoId);
          }
          case "set-focal": {
            const slug = args[2];
            const photoId = args[3];
            const presetArg = getArg("preset");
            if (!slug || !photoId || !presetArg) {
              throw new Error(
                "Usage: pnpm cli photos set-focal <album-slug> <photo-id> --preset <c|t|b|l|r|tl|tr|bl|br|mt|mb|ml|mr>"
              );
            }
            const preset = resolveFocalPreset(presetArg);
            if (!preset) {
              throw new Error(
                `Invalid preset. Use: ${Object.keys(FOCAL_SHORTHAND).join(", ")} or full names`
              );
            }
            return cmdPhotosSetFocal(slug, photoId, preset);
          }
          case "reset-focal": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli photos reset-focal <album-slug> [photo-id] [--strategy onnx|sharp]");
            const photoId = args[3]; // optional
            const strategyArg = getArg("strategy") as DetectionStrategy | undefined;
            if (strategyArg && !DETECTION_STRATEGIES.includes(strategyArg)) {
              throw new Error(`Invalid strategy. Use: ${DETECTION_STRATEGIES.join(", ")}`);
            }
            return cmdPhotosResetFocal(slug, photoId, strategyArg);
          }
          case "compare-focal": {
            const slug = args[2];
            const photoId = args[3];
            if (!slug || !photoId) throw new Error("Usage: pnpm cli photos compare-focal <album-slug> <photo-id>");
            return cmdPhotosCompareFocal(slug, photoId);
          }
          default:
            throw new Error(`Unknown: photos ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "transfers":
        switch (subcommand) {
          case "list":
            return cmdTransfersList();
          case "info": {
            const id = args[2];
            if (!id) throw new Error("Usage: pnpm cli transfers info <id>");
            return cmdTransfersInfo(id);
          }
          case "upload": {
            const dir = getArg("dir");
            const title = getArg("title");
            const expires = getArg("expires");
            if (!dir || !title) {
              throw new Error(
                'Usage: pnpm cli transfers upload --dir <path> --title <title> [--expires 7d]'
              );
            }
            return cmdTransfersUpload({ dir, title, expires: expires ?? undefined });
          }
          case "delete": {
            const id = args[2];
            if (!id) throw new Error("Usage: pnpm cli transfers delete <id>");
            return cmdTransfersDelete(id);
          }
          case "nuke":
            return cmdTransfersNuke();
          default:
            throw new Error(`Unknown: transfers ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "blog":
        switch (subcommand) {
          case "upload": {
            const slug = getArg("slug");
            const dir = getArg("dir");
            if (!slug || !dir) {
              throw new Error(
                "Usage: pnpm cli blog upload --slug <post-slug> --dir <path> [--force]"
              );
            }
            if (!isValidSlug(slug)) throw new Error("Slug must be lowercase letters, numbers, hyphens only.");
            return cmdBlogUpload({ slug, dir, force: hasFlag("force") });
          }
          case "list": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli blog list <post-slug>");
            return cmdBlogList(slug);
          }
          case "delete": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli blog delete <post-slug> [--file <filename>]");
            const file = getArg("file");
            return cmdBlogDelete(slug, file);
          }
          default:
            throw new Error(`Unknown: blog ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "notes":
        switch (subcommand) {
          case "create": {
            const slug = getArg("slug");
            const title = getArg("title");
            const markdownFile = getArg("markdown-file");
            const subtitle = getArg("subtitle");
            const visibility = parseNoteVisibility(getArg("visibility"));
            if (!slug || !title || !markdownFile) {
              throw new Error(
                "Usage: pnpm cli notes create --slug <slug> --title <title> --markdown-file <path> [--subtitle <text>] [--visibility public|unlisted|private]"
              );
            }
            const abs = path.resolve(markdownFile.replace(/^~/, process.env.HOME ?? "~"));
            if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
            const markdown = fs.readFileSync(abs, "utf-8");
            return cmdNotesCreate({ slug, title, subtitle, visibility, markdown });
          }
          case "upload": {
            const slug = getArg("slug");
            const file = getArg("file");
            const title = getArg("title");
            const subtitle = getArg("subtitle");
            const visibility = parseNoteVisibility(getArg("visibility"));
            if (!slug || !file) {
              throw new Error(
                "Usage: pnpm cli notes upload --slug <slug> --file <path> [--title <title>] [--subtitle <text>] [--visibility public|unlisted|private]"
              );
            }
            return cmdNotesUpload({ slug, file, title: title ?? undefined, subtitle: subtitle ?? undefined, visibility });
          }
          case "list": {
            const visibility = parseNoteVisibility(getArg("visibility"));
            const q = getArg("q");
            return cmdNotesList({ visibility, q });
          }
          case "update": {
            const slug = args[2];
            if (!slug) {
              throw new Error(
                "Usage: pnpm cli notes update <slug> [--title <title>] [--subtitle <text>] [--clear-subtitle] [--visibility public|unlisted|private] [--markdown-file <path>]"
              );
            }
            const title = getArg("title");
            const subtitle = hasFlag("clear-subtitle") ? null : (getArg("subtitle") ?? undefined);
            const visibility = parseNoteVisibility(getArg("visibility"));
            const markdownFile = getArg("markdown-file");
            if (!title && subtitle === undefined && !visibility && !markdownFile && !hasFlag("clear-subtitle")) {
              throw new Error("Nothing to update.");
            }
            return cmdNotesUpdate(slug, { title: title ?? undefined, subtitle, visibility, markdownFile: markdownFile ?? undefined });
          }
          case "delete": {
            const slug = args[2];
            if (!slug) throw new Error("Usage: pnpm cli notes delete <slug>");
            return cmdNotesDelete(slug);
          }
          case "share": {
            const action = args[2];
            if (action === "create") {
              const slug = args[3];
              if (!slug) throw new Error("Usage: pnpm cli notes share create <slug> [--expires-days 7] [--pin-required] [--pin 1234]");
              const expiresDaysRaw = getArg("expires-days");
              const expiresInDays = expiresDaysRaw ? parseInt(expiresDaysRaw, 10) : undefined;
              return cmdNotesShareCreate({
                slug,
                expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : undefined,
                pinRequired: hasFlag("pin-required"),
                pin: getArg("pin"),
              });
            }
            if (action === "list") {
              const slug = args[3];
              if (!slug) throw new Error("Usage: pnpm cli notes share list <slug>");
              return cmdNotesShareList(slug);
            }
            if (action === "update") {
              const slug = args[3];
              const id = args[4];
              if (!slug || !id) {
                throw new Error(
                  "Usage: pnpm cli notes share update <slug> <share-id> [--pin-required true|false] [--pin <newPin>|--clear-pin] [--expires-days <n>] [--rotate-token]"
                );
              }
              const pinRequiredArg = getArg("pin-required");
              const pinRequired =
                pinRequiredArg === undefined ? undefined : pinRequiredArg.toLowerCase() === "true";
              const expiresDaysRaw = getArg("expires-days");
              const expiresInDays = expiresDaysRaw ? parseInt(expiresDaysRaw, 10) : undefined;
              const pin = hasFlag("clear-pin") ? null : (getArg("pin") ?? undefined);
              return cmdNotesShareUpdate(slug, id, {
                pinRequired,
                pin,
                expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : undefined,
                rotateToken: hasFlag("rotate-token"),
              });
            }
            if (action === "revoke") {
              const slug = args[3];
              const id = args[4];
              if (!slug || !id) throw new Error("Usage: pnpm cli notes share revoke <slug> <share-id>");
              return cmdNotesShareRevoke(slug, id);
            }
            throw new Error(`Unknown notes share action: ${action ?? ""}`);
          }
          default:
            throw new Error(`Unknown: notes ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "bucket":
        switch (subcommand) {
          case "ls":
            return cmdBucketLs(args[2] ?? "");
          case "rm": {
            const key = args[2];
            if (!key) throw new Error("Usage: pnpm cli bucket rm <key>");
            return cmdBucketRm(key);
          }
          case "info":
            return cmdBucketInfo();
          default:
            throw new Error(`Unknown: bucket ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      case "auth":
        switch (subcommand) {
          case "revoke": {
            const adminToken = getArg("admin-token");
            const adminPassword = getArg("admin-password");
            const roleArg = (getArg("role") ?? "admin") as RevokeRole;
            const baseUrl = getArg("base-url");
            if (!adminToken || !adminPassword) {
              throw new Error(
                "Usage: pnpm cli auth revoke --admin-token <jwt> --admin-password <password> [--role admin|staff|upload|all] [--base-url http://localhost:3000]"
              );
            }
            if (!REVOKE_ROLES.includes(roleArg)) {
              throw new Error(`Invalid role. Use: ${REVOKE_ROLES.join(", ")}`);
            }
            return cmdAuthRevoke({
              adminToken,
              adminPassword,
              role: roleArg,
              baseUrl: baseUrl ?? undefined,
            });
          }
          case "sessions": {
            const adminToken = getArg("admin-token");
            const baseUrl = getArg("base-url");
            if (!adminToken) {
              throw new Error(
                "Usage: pnpm cli auth sessions --admin-token <jwt> [--base-url http://localhost:3000]"
              );
            }
            return cmdAuthListSessions({
              adminToken,
              baseUrl: baseUrl ?? undefined,
            });
          }
          default:
            throw new Error(`Unknown: auth ${subcommand ?? ""}. Run 'pnpm cli help'.`);
        }

      default:
        log(red(`Unknown command: ${command}`));
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    console.log();
    log(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/* ─── Entry point ─── */

async function main() {
  const command = args[0];

  if (hasFlag("help") || command === "help") {
    showHelp();
    return;
  }

  if (!command) {
    return interactive();
  }

  return direct();
}

main();
