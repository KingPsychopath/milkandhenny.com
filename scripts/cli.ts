#!/usr/bin/env tsx
/**
 * milk & henny — Album & R2 management CLI.
 *
 * Usage:
 *   pnpm cli <command> [subcommand] [options]
 *
 * Commands:
 *   albums list                              List all albums
 *   albums show <slug>                       Show album details
 *   albums upload [opts]                     Upload new album
 *   albums update <slug> [opts]              Update album metadata
 *   albums delete <slug>                     Delete entire album
 *
 *   photos list <album>                      List photos in album
 *   photos add <album> --dir <path>          Add photos to existing album
 *   photos delete <album> <photoId>          Delete a photo
 *   photos set-cover <album> <photoId>       Set album cover
 *
 *   bucket ls [prefix]                       Browse bucket contents
 *   bucket rm <key>                          Delete a file from bucket
 *   bucket info                              Show bucket usage stats
 */

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

/* ─── Formatting helpers ─── */

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

/* ─── Arg helpers ─── */

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

/* ─── Interactive prompts ─── */

async function ask(question: string, defaultVal?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultVal ? ` ${dim(`(${defaultVal})`)}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${cyan("›")} ${question}${suffix} `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

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

/** Show numbered options, return selected index. 0 = back, -1 = invalid. */
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

  const answer = await ask("");
  const num = parseInt(answer, 10);
  if (isNaN(num) || num < 0 || num > options.length) return -1;
  return num;
}

/** Select an album from the list. Returns slug or null. */
async function selectAlbum(): Promise<string | null> {
  const albums = listAlbums();
  if (albums.length === 0) {
    log(dim("No albums found."));
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
  if (!album) return null;

  const choice = await choose(
    `Select photo from: ${album.title}`,
    album.photos.map((p) => ({
      label: `${p.id}${p.id === album.cover ? yellow(" ★") : ""}`,
      detail: `${p.width} × ${p.height}`,
    }))
  );

  if (choice <= 0) return null;
  return album.photos[choice - 1].id;
}

/** Pause until enter is pressed */
async function pause() {
  await ask(dim("Press enter to continue..."));
}

/* ─── Commands: albums ─── */

async function cmdAlbumsList() {
  const albums = listAlbums();

  if (albums.length === 0) {
    heading("Albums");
    log(dim("No albums found."));
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

async function cmdAlbumsShow() {
  const slug = args[2];
  if (!slug) {
    log(red("Usage: pnpm cli albums show <slug>"));
    process.exit(1);
  }

  const album = getAlbum(slug);
  if (!album) {
    log(red(`Album "${slug}" not found.`));
    process.exit(1);
  }

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

async function cmdAlbumsUpload() {
  const dir = getArg("dir");
  const slug = getArg("slug");
  const title = getArg("title");
  const date = getArg("date");
  const description = getArg("description");

  if (!dir || !slug || !title || !date) {
    log(
      red(
        "Usage: pnpm cli albums upload --dir <path> --slug <slug> --title <title> --date <YYYY-MM-DD> [--description <desc>]"
      )
    );
    process.exit(1);
  }

  heading(`Uploading: ${title}`);

  const { album, jsonPath, results } = await createAlbum(
    { dir, slug, title, date, description },
    (msg) => progress(msg)
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
  log(`  ${bold("Total:")}       ${formatBytes(totalThumb + totalFull + totalOrig)}`);
  console.log();
  log(dim("Next: commit the JSON and deploy."));
  console.log();
}

async function cmdAlbumsUpdate() {
  const slug = args[2];
  if (!slug) {
    log(
      red(
        "Usage: pnpm cli albums update <slug> [--title ...] [--date ...] [--description ...] [--cover ...]"
      )
    );
    process.exit(1);
  }

  const title = getArg("title");
  const date = getArg("date");
  const description = getArg("description");
  const cover = getArg("cover");

  if (!title && !date && !description && !cover) {
    log(yellow("Nothing to update. Pass --title, --date, --description, or --cover."));
    process.exit(0);
  }

  try {
    const updated = updateAlbumMeta(slug, { title, date, description, cover });
    if (!updated) {
      log(red(`Album "${slug}" not found.`));
      process.exit(1);
    }

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
  } catch (err) {
    log(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function cmdAlbumsDelete() {
  const slug = args[2];
  if (!slug) {
    log(red("Usage: pnpm cli albums delete <slug>"));
    process.exit(1);
  }

  const album = getAlbum(slug);
  if (!album) {
    log(red(`Album "${slug}" not found.`));
    process.exit(1);
  }

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

/* ─── Commands: photos ─── */

async function cmdPhotosList() {
  const slug = args[2];
  if (!slug) {
    log(red("Usage: pnpm cli photos list <album-slug>"));
    process.exit(1);
  }

  const album = getAlbum(slug);
  if (!album) {
    log(red(`Album "${slug}" not found.`));
    process.exit(1);
  }

  heading(`${album.title} — Photos (${album.photos.length})`);

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

async function cmdPhotosAdd() {
  const slug = args[2];
  const dir = getArg("dir");

  if (!slug || !dir) {
    log(red("Usage: pnpm cli photos add <album-slug> --dir <path>"));
    process.exit(1);
  }

  heading(`Adding photos to: ${slug}`);

  try {
    const { added, album } = await addPhotos(slug, dir, (msg) =>
      progress(msg)
    );

    console.log();
    if (added.length === 0) {
      log(yellow("No new photos to add (all duplicates)."));
    } else {
      log(green(`✓ ${added.length} photos added. Album now has ${album.photos.length} photos.`));
      log(dim("Next: commit the JSON and deploy."));
    }
    console.log();
  } catch (err) {
    log(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function cmdPhotosDelete() {
  const slug = args[2];
  const photoId = args[3];

  if (!slug || !photoId) {
    log(red("Usage: pnpm cli photos delete <album-slug> <photo-id>"));
    process.exit(1);
  }

  const album = getAlbum(slug);
  if (!album) {
    log(red(`Album "${slug}" not found.`));
    process.exit(1);
  }

  const photo = album.photos.find((p) => p.id === photoId);
  if (!photo) {
    log(red(`Photo "${photoId}" not found in album "${slug}".`));
    log(dim("Available photos:"));
    for (const p of album.photos) {
      log(`  ${p.id}`);
    }
    process.exit(1);
  }

  heading(`Delete photo: ${photoId}`);
  log(`${dim("Album:")} ${album.title}`);
  log(`${dim("Size:")}  ${photo.width} × ${photo.height}`);
  if (album.cover === photoId) {
    log(yellow("This photo is the current cover. A new cover will be set."));
  }
  console.log();

  const ok = await confirm(`Delete "${photoId}" from R2 and album JSON?`);
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  try {
    const result = await deletePhoto(slug, photoId, (msg) => progress(msg));

    console.log();
    log(green(`✓ Deleted ${photoId} (${result.deletedKeys.length} files from R2)`));
    log(green(`✓ Album now has ${result.album.photos.length} photos`));
    log(dim("Next: commit the JSON and deploy."));
    console.log();
  } catch (err) {
    log(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

async function cmdPhotosSetCover() {
  const slug = args[2];
  const photoId = args[3];

  if (!slug || !photoId) {
    log(red("Usage: pnpm cli photos set-cover <album-slug> <photo-id>"));
    process.exit(1);
  }

  try {
    const album = setCover(slug, photoId);
    log(green(`✓ Cover set to "${photoId}" for album "${slug}".`));
    log(dim(`Album: ${album.title}`));
    log(dim("Next: commit the JSON and deploy."));
    console.log();
  } catch (err) {
    log(red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/* ─── Commands: bucket ─── */

async function cmdBucketLs() {
  const prefix = args[2] ?? "";

  heading(prefix ? `Bucket: ${prefix}` : "Bucket (root)");

  const objects = await listObjects(prefix);

  if (objects.length === 0) {
    log(dim("No objects found."));
    console.log();
    return;
  }

  /* Group by "folder" (first path segment after prefix) */
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
    } else {
      files.push(obj);
    }
  }

  /* Show folders first */
  for (const [folder, info] of [...folders.entries()].sort()) {
    log(
      `${cyan(folder.padEnd(45))} ${dim(`${info.count} files`).padEnd(20)} ${dim(formatBytes(info.size))}`
    );
  }

  /* Then files */
  for (const f of files.sort((a, b) => a.key.localeCompare(b.key))) {
    const name = prefix ? f.key.slice(prefix.length) : f.key;
    log(`${name.padEnd(45)} ${dim(formatBytes(f.size))}`);
  }

  console.log();
  log(dim(`Total: ${objects.length} objects, ${formatBytes(objects.reduce((s, o) => s + o.size, 0))}`));
  console.log();
}

async function cmdBucketRm() {
  const key = args[2];
  if (!key) {
    log(red("Usage: pnpm cli bucket rm <key>"));
    log(dim("Use 'pnpm cli bucket ls' to find keys."));
    process.exit(1);
  }

  log(`${dim("Key:")} ${key}`);
  console.log();

  const ok = await confirm(
    `Delete "${key}" from R2? ${dim("(This does NOT update album JSON)")}`
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
  log(`${dim("Total size:")} ${info.totalSizeMB} MB (${formatBytes(info.totalSizeBytes)})`);

  /* R2 free tier context */
  const pctUsed = ((info.totalSizeBytes / (10 * 1024 * 1024 * 1024)) * 100).toFixed(2);
  log(`${dim("Free tier:")}  ${pctUsed}% of 10 GB used`);
  console.log();
}

/* ─── Help ─── */

function showHelp() {
  console.log(`
  ${bold("milk & henny")} — Album & R2 management CLI

  ${bold("Usage:")} pnpm cli <command> [subcommand] [options]

  ${bold("Albums")}
    albums list                              List all albums
    albums show ${dim("<slug>")}                       Show album details
    albums upload ${dim("[options]")}                   Upload new album
      --dir ${dim("<path>")}      Source directory
      --slug ${dim("<slug>")}     Album slug
      --title ${dim("<title>")}   Album title
      --date ${dim("<date>")}     Album date (YYYY-MM-DD)
      --description ${dim("<desc>")}  Optional description
    albums update ${dim("<slug> [options]")}            Update album metadata
      --title, --date, --description, --cover
    albums delete ${dim("<slug>")}                     Delete entire album

  ${bold("Photos")}
    photos list ${dim("<album>")}                      List photos in album
    photos add ${dim("<album>")} --dir ${dim("<path>")}          Add photos to existing album
    photos delete ${dim("<album> <photoId>")}          Remove photo from album
    photos set-cover ${dim("<album> <photoId>")}       Set album cover photo

  ${bold("Bucket")}
    bucket ls ${dim("[prefix]")}                       Browse bucket contents
    bucket rm ${dim("<key>")}                          Delete a file from bucket
    bucket info                              Show bucket usage stats

  ${bold("Examples")}
    ${dim("$")} pnpm cli albums upload --dir ~/Desktop/party --slug jan-2026 --title "January 2026" --date 2026-01-16
    ${dim("$")} pnpm cli photos delete jan-2026 DSC00003
    ${dim("$")} pnpm cli bucket ls albums/jan-2026/thumb/
`);
}

/* ─── Interactive mode ─── */

async function interactiveAlbums() {
  while (true) {
    const choice = await choose("Albums", [
      { label: "List albums" },
      { label: "Show album details" },
      { label: "Upload new album" },
      { label: "Update album metadata" },
      { label: "Delete album" },
    ]);

    switch (choice) {
      case 0:
        return;

      case 1:
        await cmdAlbumsList();
        await pause();
        break;

      case 2: {
        const slug = await selectAlbum();
        if (slug) {
          args[2] = slug;
          await cmdAlbumsShow();
          await pause();
        }
        break;
      }

      case 3: {
        console.log();
        const dir = await ask("Source directory:");
        const slug = await ask("Album slug:");
        const title = await ask("Album title:");
        const date = await ask("Date (YYYY-MM-DD):");
        const description = await ask("Description (optional):");

        if (!dir || !slug || !title || !date) {
          log(yellow("Missing required fields. Need: dir, slug, title, date."));
          break;
        }

        /* Set args for the upload handler */
        args.length = 0;
        args.push(
          "albums",
          "upload",
          "--dir", dir,
          "--slug", slug,
          "--title", title,
          "--date", date
        );
        if (description) args.push("--description", description);

        await cmdAlbumsUpload();
        await pause();
        break;
      }

      case 4: {
        const slug = await selectAlbum();
        if (!slug) break;

        const album = getAlbum(slug);
        if (!album) break;

        console.log();
        log(dim("Leave blank to keep current value."));
        const title = await ask(`Title:`, album.title);
        const date = await ask(`Date:`, album.date);
        const description = await ask(`Description:`, album.description ?? "");

        const updates: Record<string, string | undefined> = {};
        if (title !== album.title) updates.title = title;
        if (date !== album.date) updates.date = date;
        if (description !== (album.description ?? ""))
          updates.description = description;

        if (Object.keys(updates).length === 0) {
          log(dim("No changes."));
          break;
        }

        args[2] = slug;
        args.length = 3;
        if (updates.title) args.push("--title", updates.title);
        if (updates.date) args.push("--date", updates.date);
        if (updates.description !== undefined)
          args.push("--description", updates.description);

        await cmdAlbumsUpdate();
        await pause();
        break;
      }

      case 5: {
        const slug = await selectAlbum();
        if (slug) {
          args[2] = slug;
          await cmdAlbumsDelete();
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
      { label: "List photos in album" },
      { label: "Add photos to album" },
      { label: "Delete a photo" },
      { label: "Set cover photo" },
    ]);

    switch (choice) {
      case 0:
        return;

      case 1: {
        const slug = await selectAlbum();
        if (slug) {
          args[2] = slug;
          await cmdPhotosList();
          await pause();
        }
        break;
      }

      case 2: {
        const slug = await selectAlbum();
        if (!slug) break;

        const dir = await ask("Directory with new photos:");
        if (!dir) break;

        args[2] = slug;
        args.length = 3;
        args.push("--dir", dir);

        /* Manually call the add handler */
        heading(`Adding photos to: ${slug}`);
        try {
          const { addPhotos: addPhotosFn } = await import("./album-ops");
          const { added, album } = await addPhotosFn(slug, dir, (msg) =>
            progress(msg)
          );
          console.log();
          if (added.length === 0) {
            log(yellow("No new photos to add (all duplicates)."));
          } else {
            log(
              green(
                `✓ ${added.length} photos added. Album now has ${album.photos.length} photos.`
              )
            );
          }
        } catch (err) {
          log(red(`Error: ${(err as Error).message}`));
        }
        await pause();
        break;
      }

      case 3: {
        const slug = await selectAlbum();
        if (!slug) break;

        const photoId = await selectPhoto(slug);
        if (!photoId) break;

        args[2] = slug;
        args[3] = photoId;
        await cmdPhotosDelete();
        await pause();
        break;
      }

      case 4: {
        const slug = await selectAlbum();
        if (!slug) break;

        const photoId = await selectPhoto(slug);
        if (!photoId) break;

        args[2] = slug;
        args[3] = photoId;
        await cmdPhotosSetCover();
        await pause();
        break;
      }
    }
  }
}

async function interactiveBucket() {
  while (true) {
    const choice = await choose("Bucket", [
      { label: "Browse bucket" },
      { label: "Delete a file" },
      { label: "Bucket info / usage" },
    ]);

    switch (choice) {
      case 0:
        return;

      case 1: {
        let prefix = "";
        while (true) {
          args[2] = prefix;
          await cmdBucketLs();

          const next = await ask(
            `Enter a folder to drill into, or ${dim("'back'")} to go up, or ${dim("'done'")} to stop:`
          );

          if (next === "done" || next === "") break;
          if (next === "back") {
            /* Go up one level */
            const parts = prefix.replace(/\/$/, "").split("/");
            parts.pop();
            prefix = parts.length > 0 ? parts.join("/") + "/" : "";
          } else {
            prefix = next.endsWith("/") ? next : next + "/";
          }
        }
        break;
      }

      case 2: {
        const key = await ask("Key to delete (use 'bucket ls' to find keys):");
        if (!key) break;
        args[2] = key;
        await cmdBucketRm();
        await pause();
        break;
      }

      case 3:
        await cmdBucketInfo();
        await pause();
        break;
    }
  }
}

async function interactive() {
  console.log();
  log(bold("milk & henny") + dim(" — interactive CLI"));

  while (true) {
    const choice = await choose("What would you like to do?", [
      { label: "Albums", detail: "list, upload, update, delete" },
      { label: "Photos", detail: "list, add, delete, set cover" },
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
        await interactiveBucket();
        break;

      default:
        log(dim("Invalid choice. Pick a number."));
    }
  }
}

/* ─── Router ─── */

async function main() {
  const command = args[0];
  const subcommand = args[1];

  if (hasFlag("help") || command === "help") {
    showHelp();
    return;
  }

  if (!command) {
    return interactive();
  }

  try {
    switch (command) {
      case "albums":
        switch (subcommand) {
          case "list":
            return cmdAlbumsList();
          case "show":
            return cmdAlbumsShow();
          case "upload":
            return cmdAlbumsUpload();
          case "update":
            return cmdAlbumsUpdate();
          case "delete":
            return cmdAlbumsDelete();
          default:
            log(red(`Unknown albums command: ${subcommand ?? "(none)"}`));
            log(dim("Run 'pnpm cli albums help' or 'pnpm cli help'"));
            process.exit(1);
        }
        break;

      case "photos":
        switch (subcommand) {
          case "list":
            return cmdPhotosList();
          case "add":
            return cmdPhotosAdd();
          case "delete":
            return cmdPhotosDelete();
          case "set-cover":
            return cmdPhotosSetCover();
          default:
            log(red(`Unknown photos command: ${subcommand ?? "(none)"}`));
            log(dim("Run 'pnpm cli photos help' or 'pnpm cli help'"));
            process.exit(1);
        }
        break;

      case "bucket":
        switch (subcommand) {
          case "ls":
            return cmdBucketLs();
          case "rm":
            return cmdBucketRm();
          case "info":
            return cmdBucketInfo();
          default:
            log(red(`Unknown bucket command: ${subcommand ?? "(none)"}`));
            log(dim("Run 'pnpm cli bucket help' or 'pnpm cli help'"));
            process.exit(1);
        }
        break;

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

main();
