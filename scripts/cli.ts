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
  getPhotoKeys,
} from "./album-ops";
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
  formatDuration,
  parseExpiry,
  formatBytes as formatTransferBytes,
} from "./transfer-ops";

/* ─── Formatting ─── */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

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
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f));
  if (images.length === 0) {
    return {
      valid: false,
      error: `No images found in ${absDir}. Supported: .jpg, .jpeg, .png, .webp, .heic`,
    };
  }
  return { valid: true, count: images.length };
}

/** Validate directory for transfers — accepts ALL non-hidden files */
function validateTransferDir(dir: string): { valid: boolean; error?: string; count?: number } {
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
      detail: `${p.width} × ${p.height}`,
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
      `  ${p.id.padEnd(maxId + 2)} ${dim(`${p.width} × ${p.height}`)}${coverTag}`
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

async function cmdAlbumsDelete(slug: string) {
  const album = getAlbum(slug);
  if (!album) throw new Error(`Album "${slug}" not found.`);

  heading(`Delete: ${album.title}`);
  log(`${dim("Photos:")} ${album.photos.length}`);
  log(
    `${dim("R2 files:")} ~${album.photos.length * 3} (thumb + full + original per photo)`
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
      `${cyan(p.id.padEnd(maxId + 2))} ${dim(`${p.width} × ${p.height}`)}${coverTag}`
    );
    for (const k of keys) {
      log(`  ${dim(k)}`);
    }
  }
  console.log();
}

async function cmdPhotosAdd(slug: string, dir: string) {
  heading(`Adding photos to: ${slug}`);

  const { added, album } = await addPhotos(slug, dir, (msg) =>
    progress(msg)
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://milkandhenny.com";

  heading(info.title);
  log(`${dim("ID:")}           ${info.id}`);
  log(`${dim("Files:")}        ${info.files.length}`);
  log(
    `${dim("Created:")}      ${new Date(info.createdAt).toLocaleString("en-GB")}`
  );
  log(
    `${dim("Expires:")}      ${new Date(info.expiresAt).toLocaleString("en-GB")} ${yellow(`(${remaining} left)`)}`
  );
  log(`${dim("Share URL:")}    ${green(`${baseUrl}/t/${info.id}`)}`);
  log(
    `${dim("Admin URL:")}    ${green(`${baseUrl}/t/${info.id}?token=${info.deleteToken}`)}`
  );
  console.log();

  if (info.files.length <= 30) {
    log(dim("Files:"));
    for (const f of info.files) {
      const dims = f.width && f.height ? dim(` ${f.width}×${f.height}`) : "";
      const size = formatTransferBytes(f.size);
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
    albums update ${dim("<slug>")} [options]            Update album metadata
      --title, --date, --description, --cover
    albums delete ${dim("<slug>")}                     Delete entire album + R2 files

  ${bold("Photos")}
    photos list ${dim("<album>")}                      List photos with R2 keys
    photos add ${dim("<album>")} --dir ${dim("<path>")}          Add new photos to existing album
    photos delete ${dim("<album> <photoId>")}          Remove a photo from album + R2
    photos set-cover ${dim("<album> <photoId>")}       Set album cover photo

  ${bold("Transfers")} ${dim("(private, self-destructing file shares)")}
    transfers list                           List active transfers + time left
    transfers info ${dim("<id>")}                      Show transfer details + URLs
    transfers upload                         Upload new transfer
      --dir ${dim("<path>")}      ${dim("Folder with files (images, videos, PDFs, zips — anything)")}
      --title ${dim("<title>")}   ${dim('Title for the transfer (e.g. "Photos for John")')}
      --expires ${dim("<time>")}  ${dim("Expiry: 30m, 1h, 12h, 1d, 7d, 14d, 30d (default: 7d)")}
    transfers delete ${dim("<id>")}                    Take down a transfer + delete R2 files

  ${bold("Bucket")} ${dim("(raw R2 access)")}
    bucket ls ${dim("[prefix]")}                       Browse bucket contents
    bucket rm ${dim("<key>")}                          Delete a file from bucket
    bucket info                              Show bucket usage & free tier %

  ${bold("Examples")}
    ${dim("$")} pnpm cli
    ${dim("$")} pnpm cli albums upload --dir ~/Desktop/party --slug jan-2026 --title "January 2026" --date 2026-01-16
    ${dim("$")} pnpm cli transfers upload --dir ~/Desktop/send-photos --title "Photos for John" --expires 7d
    ${dim("$")} pnpm cli transfers list
    ${dim("$")} pnpm cli transfers delete abc12345
    ${dim("$")} pnpm cli photos delete jan-2026 DSC00003
    ${dim("$")} pnpm cli bucket ls albums/jan-2026/thumb/
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

  /* Confirm */
  console.log();
  log(dim("─── Summary ───"));
  log(`${dim("Directory:")}   ${dir}`);
  log(`${dim("Slug:")}        ${slug}`);
  log(`${dim("Title:")}       ${title}`);
  log(`${dim("Date:")}        ${date}`);
  if (description) log(`${dim("Description:")} ${description}`);
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

  await cmdPhotosAdd(slug, dir.replace(/^~/, process.env.HOME ?? "~"));
}

async function interactiveAlbums() {
  while (true) {
    const choice = await choose("Albums", [
      { label: "List albums", detail: "see all albums at a glance" },
      { label: "Show album details", detail: "photos, metadata, cover" },
      { label: "Upload new album", detail: "process images and upload to R2" },
      { label: "Update album metadata", detail: "change title, date, description" },
      { label: "Delete album", detail: "remove from R2 and JSON" },
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
    }
  }
}

async function interactivePhotos() {
  while (true) {
    const choice = await choose("Photos", [
      { label: "List photos in album", detail: "IDs, dimensions, R2 keys" },
      { label: "Add photos to album", detail: "upload from a folder" },
      { label: "Delete a photo", detail: "remove from R2 and JSON" },
      { label: "Set cover photo", detail: "change album thumbnail" },
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
      { label: "Create new transfer", detail: "upload photos to shareable link" },
      { label: "Delete a transfer", detail: "take down and remove from R2" },
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
      { label: "Bucket", detail: "browse R2, delete files, usage stats" },
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
        await interactiveBucket();
        break;
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
            if (!dir || !slug || !title || !date) {
              throw new Error(
                "Usage: pnpm cli albums upload --dir <path> --slug <slug> --title <title> --date <YYYY-MM-DD> [--description <desc>]"
              );
            }
            if (!isValidSlug(slug)) throw new Error("Slug must be lowercase letters, numbers, hyphens only.");
            if (!isValidDate(date)) throw new Error("Date must be YYYY-MM-DD format.");
            return cmdAlbumsUpload({ dir, slug, title, date, description });
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
            if (!slug || !dir) throw new Error("Usage: pnpm cli photos add <album-slug> --dir <path>");
            return cmdPhotosAdd(slug, dir);
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
          default:
            throw new Error(`Unknown: transfers ${subcommand ?? ""}. Run 'pnpm cli help'.`);
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
