#!/usr/bin/env tsx
/**
 * milk & henny — Albums, words, transfers, and R2 management CLI.
 *
 * Usage:
 *   pnpm cli                                  Interactive mode
 *   pnpm cli help                             Show all commands
 *   pnpm cli <command> [subcommand] [options]  Direct mode
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import matter from "gray-matter";
import { runAlbumsCli } from "./albums-cli";
import { BASE_URL } from "@/lib/shared/config";
import { buildTransferUrl } from "@/features/transfers/routes";
import { listObjects, deleteObject, getBucketInfo } from "./r2-client";
import {
  createTransfer,
  appendToTransfer,
  getTransferInfo,
  listActiveTransfers,
  deleteTransfer,
  deleteTransferFile,
  cleanupExpiredTransfers,
  drainTransferMediaQueue,
  clearTransferMediaQueue,
  nukeAllTransfers,
  formatDuration,
  getTransferMediaStatus,
  parseExpiry,
  reconcileTransferMedia,
  retryTransferMedia,
} from "./transfer-ops";
import {
  getWordMediaUploadCheckpointFilename,
  uploadWordMediaFiles,
  listWordMediaFiles,
  deleteWordMediaFile,
  deleteAllWordMediaFiles,
  backfillWordImageVariants,
  scanOrphanWordMediaFolders,
  cleanupOrphanWordMediaFolders,
  type WordMediaTarget,
} from "./words-media-ops";
import {
  REVOKE_ROLES,
  type RevokeRole,
  createStepUpToken,
  decodeAdminTokenClaims,
  exchangeCliAuthorizationCode,
  issueAdminToken,
  listTokenSessions,
  normalizeBaseUrl,
  requestCliAuthorization,
  revokeTokenSession,
  resolveCanonicalBaseUrl,
  runAdminAuthDiagnostics,
  revokeRoleSessions,
} from "./auth-ops";
import {
  deleteCliAdminToken,
  cliCredentialStoreLabel,
  readCliAdminToken,
  writeCliAdminToken,
} from "./cli-keychain";
import { requestAdminApi, type AdminHttpMethod } from "./admin-control";
import {
  cleanupWordShares,
  createWordRecord,
  createWordShare,
  deleteWordRecord,
  getWordRecord,
  listWordRecords,
  listWordShares,
  purgeWordShares,
  resetWordShares,
  revokeWordShare,
  updateWordRecord,
  updateWordShare,
} from "./words-ops";
import { isWordType, WORD_TYPES } from "@/features/words/types";
import type { WordType } from "@/features/words/types";
import { formatMoney, type EventRecord, type TicketType } from "@/features/events/types";

/* ─── Formatting ─── */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

import { formatBytes } from "../lib/shared/format";

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

function mediaTargetLabel(target: WordMediaTarget): string {
  return target.scope === "asset" ? `shared asset "${target.assetId}"` : `word "${target.slug}"`;
}

function mediaTargetPathHint(target: WordMediaTarget): string {
  return target.scope === "asset"
    ? `words/assets/${target.assetId}/`
    : `words/media/${target.slug}/`;
}

function getMediaTargetFromArgs(opts: { slug?: string; assetId?: string }): WordMediaTarget {
  const slug = opts.slug?.trim().toLowerCase();
  const assetId = opts.assetId?.trim().toLowerCase();

  const count = Number(!!slug) + Number(!!assetId);
  if (count !== 1) {
    throw new Error("Provide exactly one target: --slug <word-slug> OR --asset <asset-id>.");
  }

  if (slug) {
    if (!isValidSlug(slug)) {
      throw new Error("Slug must be lowercase letters, numbers, hyphens only.");
    }
    return { scope: "word", slug };
  }

  if (!assetId || !isValidSlug(assetId)) {
    throw new Error("Asset ID must be lowercase letters, numbers, hyphens only.");
  }
  return { scope: "asset", assetId };
}

/** Validate directory for transfers and words media — accepts ALL non-hidden files */
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

function listMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function getCliIoConcurrency(): number {
  const raw = process.env.MH_CLI_IO_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : 6;
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(16, parsed));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
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
  opts?: { hint?: string; defaultVal?: string; required?: boolean },
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

/** Ask for a secret without echoing it to the terminal. */
async function askSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("A private password prompt requires an interactive terminal.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const privateRl = rl as readline.Interface & {
    _writeToOutput?: (value: string) => void;
  };
  privateRl._writeToOutput = () => undefined;

  process.stdout.write(`  ${cyan("›")} ${question} `);
  return new Promise((resolve) => {
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
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
  options: { label: string; detail?: string }[],
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

/** Pause until enter is pressed */
async function pause() {
  await ask("", { hint: "press enter to continue" });
}

/* ─── Command handlers ─── */
/* These return void and never call process.exit — safe for interactive mode.
 * Errors are thrown, caught by the caller. */

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
      `${cyan(folder.padEnd(45))} ${dim(`${info.count} files`).padEnd(20)} ${dim(formatBytes(info.size))}`,
    );
  }

  for (const f of files.sort((a, b) => a.key.localeCompare(b.key))) {
    const name = prefix ? f.key.slice(prefix.length) : f.key;
    log(`${name.padEnd(45)} ${dim(formatBytes(f.size))}`);
  }

  console.log();
  log(
    dim(
      `Total: ${objects.length} objects, ${formatBytes(objects.reduce((s, o) => s + o.size, 0))}`,
    ),
  );
  console.log();
}

async function cmdBucketRm(key: string) {
  log(`${dim("Key:")} ${key}`);
  console.log();

  const ok = await confirm(
    `Delete "${key}" from R2? ${dim("(⚠ This does not update durable records. Prefer the feature command.)")}`,
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

  const pctUsed = ((info.totalSizeBytes / (10 * 1024 * 1024 * 1024)) * 100).toFixed(2);
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
      `${cyan(t.id.padEnd(14))} ${t.title.padEnd(30)} ${dim(`${t.fileCount} files`).padEnd(22)} ${dim(created).padEnd(18)} ${yellow(remaining + " left")}`,
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
  log(`${dim("Created:")}      ${new Date(info.createdAt).toLocaleString("en-GB")}`);
  log(
    `${dim("Expires:")}      ${new Date(info.expiresAt).toLocaleString("en-GB")} ${yellow(`(${remaining} left)`)}`,
  );
  log(`${dim("Share URL:")}    ${green(buildTransferUrl(BASE_URL, info.id))}`);
  log(`${dim("Admin URL:")}    ${green(buildTransferUrl(BASE_URL, info.id, info.deleteToken))}`);
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

async function cmdTransfersMediaRetry(id: string, selector?: string) {
  heading(selector ? `Retry transfer media: ${id} / ${selector}` : `Retry transfer media: ${id}`);
  const result = await retryTransferMedia(id, selector);
  if (result.requeued) {
    log(green(`✓ ${selector ? "Retried media file" : "Retried transfer media state"}`));
  } else {
    log(dim("No transfer media changes were needed."));
  }
  if (result.target) {
    log(`${dim("File:")} ${result.target.filename} (${result.target.id})`);
    log(`${dim("Status:")} ${result.target.processingStatus ?? "—"}`);
    log(`${dim("Retries:")} ${result.target.retryCount ?? 0}`);
  }
  log(`${dim("Files:")} ${result.fileCount}`);
  log(`${dim("Queue length:")} ${result.queueLength}`);
  console.log();
}

async function cmdTransfersUpload(opts: { dir: string; title: string; expires?: string }) {
  heading(`Creating transfer: ${opts.title}`);
  log(dim("Resume-safe: if interrupted, rerun the same command in the same folder to continue."));
  log(
    dim(
      "Checkpoint file: .mah-transfer-upload.checkpoint.json (auto-created, auto-removed on success)",
    ),
  );
  console.log();

  let result: Awaited<ReturnType<typeof createTransfer>>;
  try {
    result = await createTransfer(opts, (msg) => progress(msg));
  } catch (error) {
    console.log();
    log(yellow("Upload interrupted. Rerun the same transfers upload command to auto-resume."));
    throw error;
  }

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
  if (result.processingCounts.queuedCount > 0 || result.processingCounts.failedCount > 0) {
    const processingParts: string[] = [];
    if (result.processingCounts.readyCount > 0)
      processingParts.push(`${result.processingCounts.readyCount} ready`);
    if (result.processingCounts.queuedCount > 0)
      processingParts.push(`${result.processingCounts.queuedCount} queued`);
    if (result.processingCounts.failedCount > 0)
      processingParts.push(`${result.processingCounts.failedCount} failed`);
    if (result.processingCounts.skippedCount > 0)
      processingParts.push(`${result.processingCounts.skippedCount} original-only`);
    log(dim(`  processing: ${processingParts.join(", ")}`));
  }
  if (
    result.transfer.files.some(
      (file) => /\.(heic|heif|hif)$/i.test(file.filename) && file.processingStatus === "skipped",
    )
  ) {
    log(dim("  note: HEIC/HIF files are stored as originals only in the CLI path"));
  }

  const expires = new Date(result.transfer.expiresAt);
  log(
    `${dim("Expires:")} ${expires.toLocaleString("en-GB")} ${yellow(`(${formatDuration(Math.floor((expires.getTime() - Date.now()) / 1000))} from now)`)}`,
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

async function cmdTransfersAppend(opts: { id: string; dir: string }) {
  heading(`Append files to transfer: ${opts.id}`);
  log(dim("Adds new files to an existing active transfer without changing its expiry."));
  log(
    dim(
      "Resume-safe: if interrupted, rerun the same append command in the same folder to continue.",
    ),
  );
  log(
    dim(
      `Checkpoint file: .mah-transfer-append.${opts.id}.checkpoint.json (auto-created, auto-removed on success)`,
    ),
  );
  console.log();

  let result: Awaited<ReturnType<typeof appendToTransfer>>;
  try {
    result = await appendToTransfer(opts, (msg) => progress(msg));
  } catch (error) {
    console.log();
    log(yellow("Append interrupted. Rerun the same transfers append command to auto-resume."));
    throw error;
  }

  console.log();
  log(
    green(
      `✓ Added ${result.addedCount} file${result.addedCount === 1 ? "" : "s"} to transfer ${result.transfer.id}`,
    ),
  );

  const { fileCounts } = result;
  const countParts: string[] = [];
  if (fileCounts.images > 0) countParts.push(`${fileCounts.images} images`);
  if (fileCounts.gifs > 0) countParts.push(`${fileCounts.gifs} GIFs`);
  if (fileCounts.videos > 0) countParts.push(`${fileCounts.videos} videos`);
  if (fileCounts.audio > 0) countParts.push(`${fileCounts.audio} audio`);
  if (fileCounts.other > 0) countParts.push(`${fileCounts.other} other`);
  if (countParts.length > 0) log(dim(`  added: ${countParts.join(", ")}`));
  if (result.processingCounts.queuedCount > 0 || result.processingCounts.failedCount > 0) {
    const processingParts: string[] = [];
    if (result.processingCounts.readyCount > 0)
      processingParts.push(`${result.processingCounts.readyCount} ready`);
    if (result.processingCounts.queuedCount > 0)
      processingParts.push(`${result.processingCounts.queuedCount} queued`);
    if (result.processingCounts.failedCount > 0)
      processingParts.push(`${result.processingCounts.failedCount} failed`);
    if (result.processingCounts.skippedCount > 0)
      processingParts.push(`${result.processingCounts.skippedCount} original-only`);
    log(dim(`  processing: ${processingParts.join(", ")}`));
  }
  if (
    result.transfer.files.some(
      (file) => /\.(heic|heif|hif)$/i.test(file.filename) && file.processingStatus === "skipped",
    )
  ) {
    log(dim("  note: HEIC/HIF files are stored as originals only in the CLI path"));
  }

  log(dim(`  transfer now has ${result.transfer.files.length} files`));
  log(`${bold("Added upload size:")} ${formatBytes(result.addedSize)}`);
  console.log();
  log(`${dim("Share URL:")} ${green(result.shareUrl)}`);
  log(`${dim("Admin URL:")} ${yellow(result.adminUrl)}`);
  console.log();
}

async function cmdTransfersDelete(id: string) {
  const info = await getTransferInfo(id);
  if (!info) throw new Error(`Transfer "${id}" not found or already expired.`);

  heading(`Delete transfer: ${info.title}`);
  log(`${dim("Files:")} ${info.files.length}`);
  log(`${dim("Remaining:")} ${yellow(formatDuration(info.remainingSeconds))}`);
  console.log();

  const ok = await confirm(`${red("Permanently")} delete transfer "${id}" and all its R2 files?`);
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

async function cmdTransfersDeleteFile(id: string, selector: string) {
  const info = await getTransferInfo(id);
  if (!info) throw new Error(`Transfer "${id}" not found or already expired.`);

  const exactId = info.files.find((file) => file.id === selector);
  const matchingFilename = info.files.filter((file) => file.filename === selector);
  const target = exactId ?? (matchingFilename.length === 1 ? matchingFilename[0] : null);

  if (!target) {
    throw new Error(
      matchingFilename.length > 1
        ? `Multiple files match "${selector}". Use the file id instead.`
        : `No file matched "${selector}" in transfer "${id}".`,
    );
  }

  heading(`Delete file from transfer: ${info.title}`);
  log(`${dim("File:")} ${target.filename}`);
  log(`${dim("File ID:")} ${target.id}`);
  log(`${dim("Kind:")} ${target.kind}`);
  console.log();

  const ok = await confirm(
    `${red("Permanently")} delete "${target.filename}" from transfer "${id}"?`,
  );
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await deleteTransferFile(id, target.id, (msg) => progress(msg));

  console.log();
  log(green(`✓ Deleted ${result.deletedObjects} objects from R2`));
  if (result.deletedTransfer) {
    log(green("✓ That was the last file; the transfer was removed"));
  } else {
    log(green(`✓ Removed ${result.file.filename} from transfer metadata`));
    log(dim(`  transfer now has ${result.transfer?.files.length ?? 0} files`));
  }
  console.log();
}

async function cmdTransfersCleanup() {
  heading("Cleanup expired transfers");
  log(dim("This removes expired/orphaned transfer storage while keeping active transfers."));
  console.log();

  const ok = await confirm("Run transfer cleanup now?");
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await cleanupExpiredTransfers((msg) => progress(msg));
  console.log();
  log(green(`✓ Removed ${result.expiredIndexEntries} expired index entries`));
  log(green(`✓ Deleted ${result.deletedObjects} orphaned files`));
  log(dim(`Scanned ${result.scannedPrefixes} transfer prefixes.`));
  console.log();
}

async function cmdTransfersMediaStatus() {
  heading("Transfer media status");
  const result = await getTransferMediaStatus();
  log(`${dim("Queue:")} ${result.queueLength}`);
  log(
    `${dim("Last heartbeat:")} ${
      result.worker.lastHeartbeatAt
        ? new Date(result.worker.lastHeartbeatAt).toLocaleString("en-GB")
        : "—"
    }`,
  );
  log(
    `${dim("Last processed:")} ${
      result.worker.lastProcessedAt
        ? new Date(result.worker.lastProcessedAt).toLocaleString("en-GB")
        : "—"
    }`,
  );
  if (result.worker.lastErrorMessage) {
    log(`${dim("Last error:")} ${yellow(result.worker.lastErrorMessage)}`);
  }
  console.log();
}

async function cmdTransfersQueueClear(skipConfirm = false) {
  heading("Clear transfer media queue");
  log(red("This deletes queued + processing transfer media jobs."));
  console.log();

  if (!skipConfirm) {
    const ok = await confirm("Clear transfer media queue now?");
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
  }

  const result = await clearTransferMediaQueue();
  log(green(`✓ Deleted ${result.deletedKeys} Redis key${result.deletedKeys === 1 ? "" : "s"}`));
  log(dim(`  queued before: ${result.queueLengthBefore}`));
  log(dim(`  processing before: ${result.processingLengthBefore}`));
  console.log();
}

async function cmdTransfersMediaDrain(limit = 8) {
  heading("Drain transfer media queue");
  const result = await drainTransferMediaQueue(limit);
  log(green(`✓ Processed ${result.processedJobs} queued jobs`));
  log(dim(`  succeeded: ${result.succeeded}`));
  log(dim(`  failed: ${result.failed}`));
  log(dim(`  skipped: ${result.skipped}`));
  log(dim(`  remaining queue: ${result.queueLength}`));
  console.log();
}

async function cmdTransfersMediaReconcile() {
  heading("Reconcile transfer media state");
  const result = await reconcileTransferMedia((msg) => progress(msg));
  console.log();
  log(green(`✓ Scanned ${result.scannedTransfers} active transfers`));
  log(green(`✓ Updated ${result.updatedTransfers} transfers`));
  log(dim(`Queue length now ${result.queueLength}`));
  console.log();
}

async function cmdTransfersNuke(skipConfirm = false) {
  const transfers = await listActiveTransfers();

  heading("Nuke all transfers");
  log(`${dim("Active transfers:")} ${transfers.length}`);
  log(red("This will permanently delete ALL transfer files from R2"));
  log(red("and wipe ALL transfer metadata from Redis."));
  console.log();

  if (!skipConfirm) {
    const ok = await confirm(`${red("PERMANENTLY")} wipe every transfer? This cannot be undone.`);
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
  }

  const result = await nukeAllTransfers((msg) => progress(msg));

  console.log();
  log(green(`✓ Deleted ${result.deletedFiles} files from R2`));
  log(green(`✓ Cleared ${result.deletedKeys} transfer keys from Redis`));
  log(dim("Clean slate."));
  console.log();
}

/* ─── Auth command handlers ─── */

const CLI_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

type CliBrowserCallback = { code: string; state: string } | { error: string; state?: string };

type CliCallbackListener = {
  redirectUri: string;
  waitForCallback: () => Promise<CliBrowserCallback>;
  close: () => Promise<void>;
};

async function startCliCallbackListener(expectedState: string): Promise<CliCallbackListener> {
  let resolveCallback!: (value: CliBrowserCallback) => void;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const callback = new Promise<CliBrowserCallback>((resolve) => {
    resolveCallback = resolve;
  });

  const server = createServer((request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid callback request.");
      return;
    }

    if (url.pathname !== "/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }

    const state = url.searchParams.get("state") ?? "";
    if (state !== expectedState) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("This callback does not belong to the waiting CLI login.");
      return;
    }

    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!code && !error) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("The authorization response was incomplete.");
      return;
    }

    const approved = Boolean(code);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(renderCliCallbackPage(approved));
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolveCallback(code ? { code, state } : { error: error ?? "access_denied", state });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Unable to start the local CLI callback listener.");
  }

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    resolveCallback({ error: "CLI sign-in timed out" });
  }, CLI_AUTH_TIMEOUT_MS);

  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    waitForCallback: () => callback,
    close: async () => {
      if (timer) clearTimeout(timer);
      if (!server.listening) return;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function renderCliCallbackPage(approved: boolean): string {
  const title = approved ? "You’re signed in." : "Sign-in was not completed.";
  const eyebrow = approved ? "access granted" : "nothing changed";
  const detail = approved
    ? "The terminal is finishing the connection now. You can leave this window open or close it."
    : "The terminal did not receive an approval. Return to it and start again when you are ready.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Milk &amp; Henny — ${approved ? "signed in" : "sign-in incomplete"}</title>
    <style>
      :root {
        color-scheme: light dark;
        --background: oklch(0.985 0.002 86.42);
        --foreground: oklch(0.214 0.012 56.42);
        --muted: oklch(0.522 0.022 55.4);
        --border: oklch(0.856 0.01 70.7);
        --amber: oklch(0.55 0.18 47.6);
        --amber-soft: oklch(0.965 0.058 95.28);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: oklch(0.214 0.012 56.42);
          --foreground: oklch(0.918 0.006 70.7);
          --muted: oklch(0.696 0.019 70.7);
          --border: oklch(0.298 0.018 55.4);
          --amber: oklch(0.82 0.16 79);
          --amber-soft: oklch(0.298 0.018 55.4);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100svh;
        display: grid;
        place-items: center;
        padding: 2rem 1.5rem;
        background: var(--background);
        color: var(--foreground);
        font-family: "Geist Mono", "SFMono-Regular", "SF Mono", ui-monospace, monospace;
        -webkit-font-smoothing: antialiased;
      }
      main { width: min(100%, 42rem); }
      .masthead {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 1.25rem;
        border-bottom: 1px solid var(--border);
        font-size: 0.75rem;
        letter-spacing: -0.02em;
      }
      .brand { font-weight: 700; letter-spacing: -0.06em; }
      .context { color: var(--muted); }
      .content { padding: clamp(3.5rem, 12vh, 7rem) 0 3rem; }
      .status {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        color: var(--amber);
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        line-height: 1;
        text-transform: uppercase;
      }
      .status-mark {
        display: grid;
        width: 1.75rem;
        height: 1.75rem;
        place-items: center;
        border: 1px solid currentColor;
        background: var(--amber-soft);
        font-size: 0.9rem;
        line-height: 1;
      }
      h1 {
        max-width: 12ch;
        margin: 1.5rem 0 1.25rem;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(2.75rem, 8vw, 5.5rem);
        font-weight: 500;
        letter-spacing: -0.065em;
        line-height: 0.98;
      }
      .detail {
        max-width: 34rem;
        margin: 0;
        color: var(--muted);
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(1.05rem, 2vw, 1.25rem);
        line-height: 1.55;
      }
      .handoff {
        display: grid;
        gap: 0.6rem;
        margin-top: 3rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--border);
      }
      .handoff-label { font-size: 0.7rem; color: var(--muted); text-transform: lowercase; }
      .handoff-value { font-size: 0.9rem; font-weight: 700; }
      footer { color: var(--muted); font-size: 0.7rem; }
      @media (max-width: 28rem) {
        .masthead { align-items: flex-start; flex-direction: column; gap: 0.4rem; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="masthead">
        <span class="brand">milk &amp; henny</span>
        <span class="context">local cli hand-off</span>
      </header>
      <section class="content" aria-labelledby="title">
        <div class="status">
          <span class="status-mark" aria-hidden="true">${approved ? "✓" : "·"}</span>
          <span>${eyebrow}</span>
        </div>
        <h1 id="title">${title}</h1>
        <p class="detail">${detail}</p>
        <div class="handoff">
          <span class="handoff-label">next</span>
          <span class="handoff-value">return to your terminal</span>
        </div>
      </section>
      <footer>milkandhenny.com · this local page can be closed</footer>
    </main>
  </body>
</html>`;
}

async function openCliBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd.exe" : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, commandArgs, { stdio: "ignore", detached: true });
    return await new Promise<boolean>((resolve) => {
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
      child.unref();
    });
  } catch {
    return false;
  }
}

async function loginWithBrowser(baseUrl: string): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("base64url");
  const listener = await startCliCallbackListener(state);
  const userAgent = `milkandhenny-cli/0.1.0 (${process.platform}; ${process.arch})`;

  try {
    const authorization = await requestCliAuthorization({
      baseUrl,
      redirectUri: listener.redirectUri,
      codeChallenge: challenge,
      state,
      userAgent,
    });

    progress("Opening your browser for admin approval...");
    const opened = await openCliBrowser(authorization.browserUrl);
    if (!opened) {
      log(yellow("Could not open a browser automatically."));
    }
    log(dim(`Approve this sign-in at: ${authorization.browserUrl}`));

    const result = await listener.waitForCallback();
    if ("error" in result) throw new Error(result.error);
    if (result.state !== state) throw new Error("CLI sign-in state did not match.");

    progress("Exchanging the one-time approval code...");
    return await exchangeCliAuthorizationCode({
      baseUrl,
      code: result.code,
      codeVerifier: verifier,
    });
  } finally {
    await listener.close();
  }
}

type CliAdminTokenCacheEntry = {
  token: string;
  expSec: number;
};

const cliAdminTokenCache = new Map<string, CliAdminTokenCacheEntry>();
const CLI_ADMIN_TOKEN_REFRESH_SKEW_SECONDS = 60;

function decodeJwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
      exp?: number;
    };
    if (!Number.isFinite(payload.exp)) return null;
    return Math.floor(payload.exp as number);
  } catch {
    return null;
  }
}

function getCachedAdminToken(baseUrl: string): string | null {
  const cached = cliAdminTokenCache.get(baseUrl);
  if (!cached) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached.expSec - now <= CLI_ADMIN_TOKEN_REFRESH_SKEW_SECONDS) {
    cliAdminTokenCache.delete(baseUrl);
    return null;
  }
  return cached.token;
}

function cacheAdminToken(baseUrl: string, token: string): void {
  const expSec = decodeJwtExp(token);
  if (!expSec) return;
  cliAdminTokenCache.set(baseUrl, { token, expSec });
}

function clearCachedAdminToken(baseUrl: string): void {
  cliAdminTokenCache.delete(baseUrl);
}

async function getStoredAdminToken(baseUrl: string): Promise<string | null> {
  const token = await readCliAdminToken(baseUrl);
  if (!token) return null;
  const expSec = decodeJwtExp(token);
  const now = Math.floor(Date.now() / 1000);
  if (!expSec || expSec - now <= CLI_ADMIN_TOKEN_REFRESH_SKEW_SECONDS) {
    await deleteCliAdminToken(baseUrl);
    return null;
  }
  cacheAdminToken(baseUrl, token);
  return token;
}

async function promptForAdminPassword(reason?: string): Promise<string> {
  if (reason) progress(reason);
  const password = await askSecret("Admin password");
  if (!password) throw new Error("Admin password is required.");
  return password;
}

function shouldRetryWithFreshAdminToken(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (!message) return false;
  if (message.includes("invalid password")) return false;
  return (
    message.includes("unauthorized") ||
    message.includes("(401)") ||
    message.includes("step_up_invalid") ||
    message.includes("invalid or expired")
  );
}

async function resolveAdminTokenForCli(opts: {
  baseUrl: string;
  adminToken?: string;
  adminPassword?: string;
  forceRefresh?: boolean;
}): Promise<string> {
  const fromArg = opts.adminToken?.trim();
  if (fromArg) return fromArg;

  if (!opts.forceRefresh) {
    const cached = getCachedAdminToken(opts.baseUrl);
    if (cached) return cached;
  } else {
    clearCachedAdminToken(opts.baseUrl);
  }

  const passwordArg = opts.adminPassword?.trim() || undefined;
  if (!opts.forceRefresh && !passwordArg) {
    const stored = await getStoredAdminToken(opts.baseUrl);
    if (stored) return stored;
  }

  const token = passwordArg
    ? await issueAdminToken({ baseUrl: opts.baseUrl, adminPassword: passwordArg })
    : await loginWithBrowser(opts.baseUrl);
  if (!passwordArg) await writeCliAdminToken(opts.baseUrl, token);
  cacheAdminToken(opts.baseUrl, token);
  return token;
}

async function withResolvedAdminToken<T>(
  opts: {
    baseUrl: string;
    adminToken?: string;
    adminPassword?: string;
  },
  task: (adminToken: string) => Promise<T>,
): Promise<T> {
  const initialToken = await resolveAdminTokenForCli(opts);

  try {
    return await task(initialToken);
  } catch (error) {
    if (opts.adminToken || !shouldRetryWithFreshAdminToken(error)) {
      throw error;
    }

    progress("Refreshing admin session...");
    const refreshedToken = await resolveAdminTokenForCli({
      ...opts,
      forceRefresh: true,
    });
    return task(refreshedToken);
  }
}

/* ─── Deployed admin API control ─── */

function readAdminJsonInput(): unknown | undefined {
  const inline = getArg("json");
  const file = getArg("file") ?? getArg("body-file");
  if (inline && file) throw new Error("Use either --json or --file, not both.");
  if (!inline && !file) return undefined;

  const source = file ? fs.readFileSync(path.resolve(file), "utf8") : inline;
  try {
    return JSON.parse(source ?? "") as unknown;
  } catch {
    throw new Error(file ? `Invalid JSON in ${file}` : "Invalid JSON passed to --json");
  }
}

function printAdminJson(value: unknown): void {
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value ?? null, null, 2));
}

function adminBaseUrl(): string {
  return normalizeBaseUrl(getArg("base-url") || BASE_URL || "http://localhost:3000");
}

async function resolvedAdminRequest(options: {
  baseUrl?: string;
  method: AdminHttpMethod;
  path: string;
  body?: unknown;
}): Promise<unknown> {
  const requestedBaseUrl = normalizeBaseUrl(options.baseUrl || adminBaseUrl());
  const baseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);
  const adminPasswordArg = getArg("admin-password")?.trim() || undefined;
  const adminToken = getArg("admin-token");
  let stepUpToken = getArg("step-up-token");

  if (hasFlag("step-up")) {
    const storedToken = adminToken || adminPasswordArg ? null : await getStoredAdminToken(baseUrl);
    const adminPassword =
      adminPasswordArg ?? (await promptForAdminPassword("Re-authenticate for this action."));
    const token =
      adminToken || storedToken || (await resolveAdminTokenForCli({ baseUrl, adminPassword }));
    stepUpToken = (await createStepUpToken({ baseUrl, adminToken: token, adminPassword })).token;
  }

  return withResolvedAdminToken({ baseUrl, adminToken, adminPassword: adminPasswordArg }, (token) =>
    requestAdminApi({
      baseUrl,
      adminToken: token,
      method: options.method,
      path: options.path,
      body: options.body,
      stepUpToken,
    }),
  );
}

async function confirmAdminMutation(method: AdminHttpMethod, path: string, body: unknown) {
  if (method === "GET") return true;

  if (hasFlag("dry-run")) {
    log(yellow("dry run — request not sent"));
    log(`${method} ${path}`);
    if (body !== undefined) printAdminJson(body);
    return false;
  }

  if (hasFlag("yes")) return true;
  const summary = body === undefined ? "no body" : JSON.stringify(body).slice(0, 240);
  return confirm(`${method} ${path} · ${summary}. Send this request?`);
}

async function cmdAdminRequest(methodRaw: string, requestPath: string) {
  const method = methodRaw.toUpperCase() as AdminHttpMethod;
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    throw new Error("Method must be GET, POST, PUT, PATCH, or DELETE.");
  }
  const body = readAdminJsonInput();
  if (!(await confirmAdminMutation(method, requestPath, body))) return;
  const result = await resolvedAdminRequest({ method, path: requestPath, body });
  printAdminJson(result);
}

function adminEventPath(slug: string): string {
  return `/api/admin/events/${encodeURIComponent(slug)}`;
}

function asAdminEventResponse(value: unknown): { event: EventRecord; tickets?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The admin API returned an invalid event response.");
  }
  const record = value as { event?: unknown; tickets?: unknown };
  if (!record.event || typeof record.event !== "object" || Array.isArray(record.event)) {
    throw new Error("The admin API response did not contain an event.");
  }
  return { event: record.event as EventRecord, tickets: record.tickets };
}

function parseMoneyMinor(value: string): number {
  const clean = value.trim().replace(/^£/, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    throw new Error(`Invalid price "${value}". Use pounds, for example 10 or 10.50.`);
  }
  return Math.round(Number(clean) * 100);
}

function parseBooleanFlag(name: string): boolean | undefined {
  const value = getArg(name);
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

async function loadAdminEvent(slug: string): Promise<{ event: EventRecord; tickets?: unknown }> {
  return asAdminEventResponse(
    await resolvedAdminRequest({ method: "GET", path: adminEventPath(slug) }),
  );
}

async function cmdEventsList() {
  const data = await resolvedAdminRequest({ method: "GET", path: "/api/admin/events" });
  printAdminJson(data);
}

async function cmdEventsCreate() {
  const body = readAdminJsonInput();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("events create requires an object in --json or --file.");
  }
  if (!(await confirmAdminMutation("POST", "/api/admin/events", body))) return;
  printAdminJson(await resolvedAdminRequest({ method: "POST", path: "/api/admin/events", body }));
}

async function cmdEventsShow(slug: string) {
  printAdminJson(await resolvedAdminRequest({ method: "GET", path: adminEventPath(slug) }));
}

async function cmdEventsUpdate(slug: string) {
  const body = readAdminJsonInput();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("events update requires an object in --json or --file.");
  }
  if (!(await confirmAdminMutation("PATCH", adminEventPath(slug), body))) return;
  printAdminJson(await resolvedAdminRequest({ method: "PATCH", path: adminEventPath(slug), body }));
}

async function cmdEventsDelete(slug: string) {
  const requestPath = adminEventPath(slug);
  if (!(await confirmAdminMutation("DELETE", requestPath, undefined))) return;
  printAdminJson(await resolvedAdminRequest({ method: "DELETE", path: requestPath }));
}

function updatedTicketType(existing: TicketType): TicketType {
  const name = getArg("name");
  const description = getArg("description");
  const price = getArg("price");
  const quantity = getArg("quantity");
  const perPersonLimit = getArg("per-person-limit");
  const currency = getArg("currency");
  const hidden = parseBooleanFlag("hidden");

  if (
    name === undefined &&
    description === undefined &&
    price === undefined &&
    quantity === undefined &&
    perPersonLimit === undefined &&
    currency === undefined &&
    hidden === undefined
  ) {
    throw new Error("Provide at least one ticket field to update.");
  }

  return {
    ...existing,
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(description !== undefined ? { description: description.trim() || undefined } : {}),
    ...(price !== undefined ? { priceMinor: parseMoneyMinor(price) } : {}),
    ...(quantity !== undefined ? { quantity: parsePositiveInteger(quantity, "quantity") } : {}),
    ...(perPersonLimit !== undefined
      ? { perPersonLimit: parsePositiveInteger(perPersonLimit, "per-person-limit") }
      : {}),
    ...(currency !== undefined ? { currency: currency.trim().toUpperCase() } : {}),
    ...(hidden !== undefined ? { hidden } : {}),
  };
}

async function saveAdminTicketTypes(slug: string, ticketTypes: TicketType[]): Promise<void> {
  const body = { ticketTypes };
  if (!(await confirmAdminMutation("PATCH", adminEventPath(slug), body))) return;
  printAdminJson(await resolvedAdminRequest({ method: "PATCH", path: adminEventPath(slug), body }));
}

async function cmdEventsTicketList(slug: string) {
  const response = await loadAdminEvent(slug);
  const ticketSummary =
    response.tickets && typeof response.tickets === "object" && !Array.isArray(response.tickets)
      ? (response.tickets as { tickets?: unknown[] })
      : undefined;
  const tickets = Array.isArray(ticketSummary?.tickets) ? ticketSummary.tickets : [];
  const counts = new Map<string, number>();
  for (const ticket of tickets) {
    if (!ticket || typeof ticket !== "object") continue;
    const record = ticket as { ticketTypeName?: unknown; status?: unknown };
    if (record.status === "valid" && typeof record.ticketTypeName === "string") {
      counts.set(record.ticketTypeName, (counts.get(record.ticketTypeName) ?? 0) + 1);
    }
  }
  for (const type of response.event.ticketTypes) {
    log(
      `${type.id} · ${type.name} · ${formatMoney(type.priceMinor, type.currency)} · ${counts.get(type.name) ?? 0}/${type.quantity} sold`,
    );
    if (type.description) log(`  ${dim(type.description)}`);
  }
}

async function cmdEventsTicketAdd(slug: string) {
  const name = getArg("name")?.trim();
  if (!name) throw new Error("events ticket add requires --name.");
  const response = await loadAdminEvent(slug);
  const id = (getArg("id") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-")).replace(/^-|-$/g, "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error("Ticket ID may contain only letters, numbers, _ and -.");
  if (response.event.ticketTypes.some((type) => type.id === id)) {
    throw new Error(`Ticket type "${id}" already exists.`);
  }
  const ticket: TicketType = {
    id,
    name,
    description: getArg("description")?.trim() || undefined,
    priceMinor: parseMoneyMinor(getArg("price") ?? "0"),
    currency: (getArg("currency") || "GBP").toUpperCase(),
    quantity: parsePositiveInteger(getArg("quantity") ?? "1", "quantity"),
    perPersonLimit: parsePositiveInteger(getArg("per-person-limit") ?? "4", "per-person-limit"),
    hidden: parseBooleanFlag("hidden") ?? false,
  };
  await saveAdminTicketTypes(slug, [...response.event.ticketTypes, ticket]);
}

async function cmdEventsTicketUpdate(slug: string, ticketId: string) {
  const response = await loadAdminEvent(slug);
  const existing = response.event.ticketTypes.find((type) => type.id === ticketId);
  if (!existing) throw new Error(`Ticket type "${ticketId}" not found.`);
  const next = updatedTicketType(existing);
  await saveAdminTicketTypes(
    slug,
    response.event.ticketTypes.map((type) => (type.id === ticketId ? next : type)),
  );
}

async function cmdEventsTicketRemove(slug: string, ticketId: string) {
  const response = await loadAdminEvent(slug);
  if (!response.event.ticketTypes.some((type) => type.id === ticketId)) {
    throw new Error(`Ticket type "${ticketId}" not found.`);
  }
  await saveAdminTicketTypes(
    slug,
    response.event.ticketTypes.filter((type) => type.id !== ticketId),
  );
}

async function cmdAuthListSessions(opts: {
  baseUrl?: string;
  adminToken?: string;
  adminPassword?: string;
}) {
  const requestedBaseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const baseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);

  heading("Token sessions");
  log(`${dim("Base URL:")} ${baseUrl}`);
  if (baseUrl !== requestedBaseUrl) {
    log(`${dim("Input URL:")} ${requestedBaseUrl}`);
    log(dim("Using canonical host to avoid auth-header loss on redirects."));
  }
  console.log();

  const data = await withResolvedAdminToken(
    { baseUrl, adminToken: opts.adminToken, adminPassword: opts.adminPassword },
    (adminToken) => listTokenSessions({ baseUrl, adminToken }),
  );
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  if (sessions.length === 0) {
    log(dim("No sessions found."));
    console.log();
    return;
  }

  log(
    dim(`Current token versions: admin=${data.currentTv.admin}, upload=${data.currentTv.upload}`),
  );
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
      `${cyan(s.role.padEnd(7))} ${status.padEnd(14)} ${dim(jtiShort.padEnd(20))} ${dim(`tv ${s.tv}`.padEnd(6))} ${dim(ip.padEnd(16))} ${dim(`exp ${formatDuration(expiresIn)}`.padEnd(18))} ${dim(`iat ${formatDuration(issuedAgo)} ago`.padEnd(22))} ${dim(uaShort)}`,
    );
  }
  if (sessions.length > 60) {
    console.log();
    log(
      dim(
        `Showing first 60 of ${sessions.length}. Use filter/search in the admin dashboard for longer lists.`,
      ),
    );
  }
  console.log();
}

function formatUnixSecondsForCli(epochSeconds?: number): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return "—";
  return new Date(epochSeconds * 1000).toLocaleString();
}

async function cmdAuthDiagnose(opts: {
  baseUrl?: string;
  adminToken?: string;
  adminPassword?: string;
}) {
  const requestedBaseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const baseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);
  const resolvedToken =
    opts.adminToken?.trim() ||
    (opts.adminPassword ? undefined : await resolveAdminTokenForCli({ baseUrl }));

  heading("Auth diagnostics");
  log(`${dim("Base URL:")} ${baseUrl}`);
  if (baseUrl !== requestedBaseUrl) {
    log(`${dim("Input URL:")} ${requestedBaseUrl}`);
    log(dim("Using canonical host to avoid auth-header loss on redirects."));
  }
  console.log();

  progress("Running auth probes...");
  const report = await runAdminAuthDiagnostics({
    baseUrl,
    adminPassword: opts.adminPassword,
    adminToken: resolvedToken,
  });
  console.log();

  if (report.verify) {
    const verifyState = report.verify.ok
      ? green(`ok (${report.verify.status ?? "n/a"})`)
      : red(`failed (${report.verify.status ?? "n/a"})`);
    log(
      `${dim("Verify:")} ${verifyState}${report.verify.error ? ` ${dim(report.verify.error)}` : ""}`,
    );
  } else {
    log(`${dim("Verify:")} ${dim("skipped (token mode)")}`);
  }

  if (report.tokenClaims) {
    const claims = report.tokenClaims;
    const jtiShort =
      typeof claims.jti === "string" && claims.jti.length > 22
        ? `${claims.jti.slice(0, 10)}…${claims.jti.slice(-8)}`
        : (claims.jti ?? "—");
    log(
      `${dim("Token:")} role=${claims.role ?? "?"} tv=${claims.tv ?? "?"} exp=${formatUnixSecondsForCli(claims.exp)} iat=${formatUnixSecondsForCli(claims.iat)} jti=${jtiShort}`,
    );
  } else {
    log(`${dim("Token:")} ${dim("not decoded")}`);
  }
  console.log();

  if (report.probes.length === 0) {
    log(yellow("No protected-route probes were run because no usable admin token was obtained."));
    console.log();
    return;
  }

  let failedCount = 0;
  for (const probe of report.probes) {
    const state = probe.ok
      ? green(`ok (${probe.status ?? "n/a"})`)
      : red(`failed (${probe.status ?? "n/a"})`);
    if (!probe.ok) failedCount += 1;
    log(`${dim(`${probe.method} ${probe.path}`.padEnd(34))} ${state} ${dim(`· ${probe.name}`)}`);
    if (probe.error) {
      log(dim(`  -> ${probe.error}`));
    }
  }
  console.log();

  if (failedCount === 0) {
    log(green("✓ Auth flow healthy for this base URL."));
    console.log();
    return;
  }

  const hasVerifySuccess = report.verify?.ok ?? Boolean(opts.adminToken);
  const hasUnauthorizedProtected = report.probes.some(
    (probe) => probe.ok === false && probe.status === 401,
  );
  if (hasVerifySuccess && hasUnauthorizedProtected) {
    log(
      yellow(
        "Verify succeeded but protected routes returned 401. Check for AUTH_SECRET mismatch across deployments or a proxy stripping Authorization headers.",
      ),
    );
  } else {
    log(yellow("Auth diagnostics found failures. See probe errors above."));
  }
  console.log();
}

async function cmdAuthLogin(opts: { baseUrl?: string; adminPassword?: string }) {
  const requestedBaseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const baseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);

  heading("Sign in to the CLI");
  log(`${dim("Base URL:")} ${baseUrl}`);
  if (baseUrl !== requestedBaseUrl) {
    log(`${dim("Input URL:")} ${requestedBaseUrl}`);
    log(dim("Using canonical host so the stored token matches future API calls."));
  }
  console.log();

  const token = opts.adminPassword?.trim()
    ? await issueAdminToken({ baseUrl, adminPassword: opts.adminPassword.trim() })
    : await loginWithBrowser(baseUrl);
  await writeCliAdminToken(baseUrl, token);
  cacheAdminToken(baseUrl, token);

  const claims = decodeAdminTokenClaims(token);
  console.log();
  log(green("✓ Signed in."));
  log(dim(`The JWT was stored in ${cliCredentialStoreLabel()}. The password was not stored.`));
  if (claims?.exp) log(dim(`Expires: ${formatUnixSecondsForCli(claims.exp)}`));
  console.log();
}

async function cmdAuthLogout(opts: { baseUrl?: string }) {
  const requestedBaseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const canonicalBaseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);
  const baseUrls = [...new Set([requestedBaseUrl, canonicalBaseUrl])];
  let removed = false;

  for (const baseUrl of baseUrls) {
    removed = (await deleteCliAdminToken(baseUrl)) || removed;
    clearCachedAdminToken(baseUrl);
  }

  console.log();
  log(removed ? green("✓ Signed out. Local CLI token removed.") : dim("No local CLI token found."));
  console.log();
}

async function cmdAuthRevoke(opts: {
  baseUrl?: string;
  role?: RevokeRole;
  adminToken?: string;
  adminPassword?: string;
}) {
  const requestedBaseUrl = normalizeBaseUrl(opts.baseUrl || BASE_URL || "http://localhost:3000");
  const baseUrl = await resolveCanonicalBaseUrl(requestedBaseUrl);
  const role = opts.role;

  heading("Revoke token sessions");
  log(`${dim("Base URL:")} ${baseUrl}`);
  if (baseUrl !== requestedBaseUrl) {
    log(`${dim("Input URL:")} ${requestedBaseUrl}`);
    log(dim("Using canonical host to avoid auth-header loss on redirects."));
  }
  log(`${dim("Scope:")}    ${role ?? "current CLI session"}`);
  console.log();

  if (!role) {
    const storedToken = opts.adminToken ? null : await getStoredAdminToken(baseUrl);
    const providedPassword = opts.adminPassword?.trim() || undefined;
    const password =
      providedPassword ?? (await promptForAdminPassword("Re-authenticate to revoke this session."));
    const token =
      storedToken ??
      (await resolveAdminTokenForCli({
        baseUrl,
        adminToken: opts.adminToken,
        adminPassword: password,
      }));
    const claims = decodeAdminTokenClaims(token);
    if (!claims?.jti) throw new Error("Admin session has no valid session id.");

    progress("Requesting step-up token...");
    const stepUpData = await createStepUpToken({
      baseUrl,
      adminToken: token,
      adminPassword: password,
    });
    progress("Revoking the current session...");
    await revokeTokenSession({
      baseUrl,
      adminToken: token,
      stepUpToken: stepUpData.token,
      jti: claims.jti,
    });
    if (storedToken) await deleteCliAdminToken(baseUrl);
    clearCachedAdminToken(baseUrl);
    console.log();
    log(green(`✓ Session revoked remotely and removed from ${cliCredentialStoreLabel()}.`));
    console.log();
    return;
  }

  const adminPassword =
    opts.adminPassword?.trim() ||
    (await promptForAdminPassword("Re-authenticate to revoke sessions."));
  const revokeData = await withResolvedAdminToken(
    { baseUrl, adminToken: opts.adminToken, adminPassword },
    async (adminToken) => {
      progress("Requesting step-up token...");
      const stepUpData = await createStepUpToken({
        baseUrl,
        adminToken,
        adminPassword,
      });

      progress("Revoking sessions...");
      return revokeRoleSessions({
        baseUrl,
        adminToken,
        stepUpToken: stepUpData.token,
        role,
      });
    },
  );

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
  if (role === "admin" || role === "all") {
    clearCachedAdminToken(baseUrl);
    await deleteCliAdminToken(baseUrl);
    log(dim("Cleared the local admin session for this base URL."));
  }
  console.log();
}

/* ─── Words media command handlers ─── */

async function cmdWordsMediaUpload(opts: {
  target: WordMediaTarget;
  dir: string;
  force?: boolean;
}) {
  heading(`Uploading media for ${mediaTargetLabel(opts.target)}`);
  log(dim(`target path: ${mediaTargetPathHint(opts.target)}`));
  log(
    dim(
      "Resume-safe: if interrupted, rerun the same media upload command in the same folder to continue.",
    ),
  );
  log(
    dim(
      `Checkpoint file: ${getWordMediaUploadCheckpointFilename(opts.target)} (auto-created, auto-removed on success)`,
    ),
  );
  console.log();

  let result: Awaited<ReturnType<typeof uploadWordMediaFiles>>;
  try {
    result = await uploadWordMediaFiles(opts.target, opts.dir, {
      force: opts.force,
      onProgress: (msg) => progress(msg),
    });
  } catch (error) {
    console.log();
    log(yellow("Media upload interrupted. Rerun the same media upload command to auto-resume."));
    throw error;
  }

  console.log();

  if (result.uploaded.length > 0) {
    log(
      green(
        `✓ Uploaded ${result.uploaded.length} new file${result.uploaded.length > 1 ? "s" : ""}`,
      ),
    );
    const totalNew = result.uploaded.reduce((sum, r) => sum + r.size, 0);
    log(dim(`  New: ${formatBytes(totalNew)}`));
  }

  if (result.skipped.length > 0) {
    log(dim(`  Skipped ${result.skipped.length} (already in R2 — use --force to overwrite)`));
  }

  if (result.uploaded.length === 0 && result.skipped.length > 0) {
    log(dim("Nothing new to upload."));
  }

  if (result.uploaded.length > 0) {
    console.log();
    log(bold("New markdown snippets:"));
    console.log();
    for (const r of result.uploaded) {
      const tag = r.overwrote ? dim(" (overwritten)") : "";
      log(`  ${r.markdown}${tag}`);
    }
  }

  const allInR2 = await listWordMediaFiles(opts.target);
  if (allInR2.length > 0) {
    console.log();
    log(bold(`All files in ${mediaTargetPathHint(opts.target)} (${allInR2.length} total):`));
    console.log();
    for (const media of allInR2) {
      log(`  ${media.filename}  ${dim(formatBytes(media.size))}`);
    }
  }

  console.log();
  log(
    dim(
      `Tip: use generated paths directly in markdown, e.g. ${mediaTargetPathHint(opts.target)}...`,
    ),
  );
  console.log();
}

async function cmdWordsMediaList(target: WordMediaTarget) {
  heading(`Words media: ${mediaTargetLabel(target)}`);
  log(dim(`path: ${mediaTargetPathHint(target)}`));

  const files = await listWordMediaFiles(target);
  if (files.length === 0) {
    log(dim("No files found for this target."));
    console.log();
    return;
  }

  for (const f of files) {
    const date = f.lastModified ? f.lastModified.toLocaleDateString() : "—";
    log(`  ${f.filename}  ${dim(formatBytes(f.size))}  ${dim(date)}`);
    console.log();
  }
  log(dim(`${files.length} files · ${formatBytes(files.reduce((s, f) => s + f.size, 0))} total`));
  console.log();
}

async function cmdWordsMediaDelete(target: WordMediaTarget, filename?: string) {
  if (filename) {
    heading(`Delete media file: ${filename}`);
    const ok = await confirm(`Delete ${mediaTargetPathHint(target)}${filename} from R2?`);
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
    await deleteWordMediaFile(target, filename, (msg) => progress(msg));
    log(green(`✓ Deleted ${filename}`));
    console.log();
    return;
  }

  heading(`Delete all media for ${mediaTargetLabel(target)}`);
  const files = await listWordMediaFiles(target);
  log(`${dim("Files:")} ${files.length}`);
  log(red("This will delete ALL files for this target from R2."));
  console.log();

  const ok = await confirm(`Delete all ${files.length} files in ${mediaTargetPathHint(target)}?`);
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const deleted = await deleteAllWordMediaFiles(target, (msg) => progress(msg));
  log(green(`✓ Deleted ${deleted} files`));
  console.log();
}

async function cmdWordsMediaBackfillImages(force = false) {
  heading("Backfill responsive word images");
  const result = await backfillWordImageVariants((msg) => progress(msg), { force });
  console.log();
  log(green(`✓ Processed: ${result.processed}`));
  if (result.skipped) log(dim(`  Skipped: ${result.skipped}`));
  if (result.failed) log(red(`  Failed: ${result.failed}`));
}

async function cmdWordsMediaOrphans(limitRaw?: string) {
  const parsed = Number(limitRaw ?? "50");
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 500) : 50;

  heading("Word media orphan scan");
  log(dim("Scans words/media/<slug>/ folders with no matching word slug in metadata."));
  console.log();

  const summary = await scanOrphanWordMediaFolders({ limit });
  if (!summary.r2Configured) {
    log(yellow("R2 is not configured. Cannot scan word media orphans."));
    console.log();
    return;
  }

  log(`${dim("Scanned folders:")} ${summary.scannedFolders}`);
  log(`${dim("Linked words:")}    ${summary.linkedWords}`);
  log(`${dim("Orphan folders:")}  ${summary.orphanFolders}`);
  log(`${dim("Orphan objects:")}  ${summary.orphanObjects}`);
  log(`${dim("Orphan bytes:")}    ${formatBytes(summary.orphanBytes)}`);
  console.log();

  if (summary.orphans.length === 0) {
    log(green("✓ No orphan word-media folders found."));
    console.log();
    return;
  }

  log(bold(`Showing ${summary.orphans.length} orphan folder(s):`));
  for (const folder of summary.orphans) {
    const latest = folder.latestModifiedAt
      ? new Date(folder.latestModifiedAt).toLocaleString()
      : "—";
    log(
      `  ${folder.slug}  ${dim(`${folder.objectCount} objects`)}  ${dim(formatBytes(folder.totalBytes))}  ${dim(latest)}`,
    );
  }
  console.log();
}

async function cmdWordsMediaPurgeStale(skipConfirm = false) {
  heading("Purge stale word media");
  log(dim("Deletes orphan words/media/<slug>/ folders with no existing page slug."));
  console.log();

  if (!skipConfirm) {
    const ok = await confirm("Purge stale word media folders now?");
    if (!ok) {
      log(dim("Cancelled."));
      console.log();
      return;
    }
  }

  const result = await cleanupOrphanWordMediaFolders();
  if (!result.r2Configured) {
    log(yellow("R2 is not configured. Nothing to clean."));
    console.log();
    return;
  }

  log(green(`✓ Deleted folders: ${result.deletedFolders}`));
  log(green(`✓ Deleted objects: ${result.deletedObjects}`));
  log(green(`✓ Deleted bytes: ${formatBytes(result.deletedBytes)}`));
  log(dim(`Scanned folders: ${result.scannedFolders} · linked words: ${result.linkedWords}`));
  console.log();
}

/* ─── Words command handlers ─── */

const NOTE_VISIBILITIES = ["public", "unlisted", "private"] as const;
type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

function parseNoteVisibility(value?: string): NoteVisibility | undefined {
  if (!value) return undefined;
  return NOTE_VISIBILITIES.includes(value as NoteVisibility)
    ? (value as NoteVisibility)
    : undefined;
}

function parseWordType(value?: string): WordType | undefined {
  if (!value) return undefined;
  if (value === "post") return "blog";
  return isWordType(value) ? value : undefined;
}

function parseTags(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const tags = [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return tags.length > 0 ? tags : undefined;
}

function parseBooleanInput(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return undefined;
}

function toAbsolutePath(userPath: string): string {
  return path.resolve(userPath.replace(/^~/, process.env.HOME ?? "~"));
}

function resolvePathCaseInsensitive(absPath: string): string | null {
  if (fs.existsSync(absPath)) return absPath;
  if (!path.isAbsolute(absPath)) return null;

  const parts = absPath.split(path.sep).filter(Boolean);
  let current: string = path.sep;

  for (const part of parts) {
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) return null;
    const entries = fs.readdirSync(current);
    const exact = entries.find((entry) => entry === part);
    if (exact) {
      current = path.join(current, exact);
      continue;
    }
    const ciMatches = entries.filter((entry) => entry.toLowerCase() === part.toLowerCase());
    if (ciMatches.length !== 1) return null;
    current = path.join(current, ciMatches[0]);
  }

  return fs.existsSync(current) ? current : null;
}

function resolveMarkdownFilePath(filePath: string): { requestedAbs: string; resolvedAbs: string } {
  const requestedAbs = toAbsolutePath(filePath);
  const resolvedAbs = resolvePathCaseInsensitive(requestedAbs) ?? requestedAbs;
  return { requestedAbs, resolvedAbs };
}

function assertReadableMarkdownFile(filePath: string): {
  requestedAbs: string;
  resolvedAbs: string;
} {
  const paths = resolveMarkdownFilePath(filePath);
  if (!fs.existsSync(paths.resolvedAbs)) {
    throw new Error(`File not found: ${paths.requestedAbs}`);
  }
  const stats = fs.statSync(paths.resolvedAbs);
  if (!stats.isFile())
    throw new Error(`Expected a file path, but received a directory: ${paths.resolvedAbs}`);
  return paths;
}

function readMarkdownFile(filePath: string): string {
  const { resolvedAbs } = assertReadableMarkdownFile(filePath);
  return fs.readFileSync(resolvedAbs, "utf-8");
}

function slugifyLoose(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "new-note";
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildWordTemplateMarkdown(opts: {
  slug: string;
  title: string;
  subtitle?: string;
  type: WordType;
  visibility: NoteVisibility;
  tags?: string[];
}): string {
  const tags =
    opts.tags && opts.tags.length > 0
      ? `[${opts.tags.map((t) => `"${escapeYamlString(t)}"`).join(", ")}]`
      : "[]";
  const subtitleLine = opts.subtitle
    ? `subtitle: "${escapeYamlString(opts.subtitle)}"`
    : 'subtitle: ""';
  return [
    "---",
    `slug: "${escapeYamlString(opts.slug)}"`,
    `title: "${escapeYamlString(opts.title)}"`,
    subtitleLine,
    `type: "${opts.type}"`,
    `visibility: "${opts.visibility}"`,
    `tags: ${tags}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    "Start writing here.",
    "",
  ].join("\n");
}

async function cmdWordsTemplate(opts: {
  out: string;
  title?: string;
  slug?: string;
  subtitle?: string;
  type?: WordType;
  visibility?: NoteVisibility;
  tags?: string[];
  overwrite?: boolean;
  quiet?: boolean;
}): Promise<string> {
  const requestedAbs = toAbsolutePath(opts.out);
  const exists = fs.existsSync(requestedAbs);
  if (exists && !opts.overwrite) {
    throw new Error(`File already exists: ${requestedAbs}. Re-run with --overwrite to replace it.`);
  }
  const derivedTitle = (
    opts.title?.trim() || path.basename(requestedAbs, path.extname(requestedAbs))
  ).trim();
  const title = derivedTitle || "New Note";
  const slug =
    opts.slug?.trim() || slugifyLoose(path.basename(requestedAbs, path.extname(requestedAbs)));
  const markdown = buildWordTemplateMarkdown({
    slug,
    title,
    subtitle: opts.subtitle,
    type: opts.type ?? "note",
    visibility: opts.visibility ?? "private",
    tags: opts.tags,
  });
  fs.mkdirSync(path.dirname(requestedAbs), { recursive: true });
  fs.writeFileSync(requestedAbs, markdown, "utf-8");

  if (!opts.quiet) {
    heading("Create markdown template");
    log(green(`✓ Wrote template: ${requestedAbs}`));
    log(dim("Tip: edit it, then use Words → Content → Create word or 'pnpm cli words create'."));
    console.log();
  }
  return requestedAbs;
}

function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function noteSyncInputFromFile(
  absFile: string,
  rootDir: string,
): {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: NoteVisibility;
  tags?: string[];
  featured?: boolean;
  markdown: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  relPath: string;
} {
  const raw = fs.readFileSync(absFile, "utf-8");
  const parsed = matter(raw);
  const relPath = path.relative(rootDir, absFile).replace(/\\/g, "/");
  const filenameSlug = path.basename(absFile, ".md").toLowerCase();
  const folderTypeGuess = relPath.split("/")[0];
  const slug =
    (typeof parsed.data.slug === "string" && parsed.data.slug.trim().toLowerCase()) || filenameSlug;
  const title =
    (typeof parsed.data.title === "string" && parsed.data.title.trim()) || slug.replace(/-/g, " ");
  const subtitle =
    typeof parsed.data.subtitle === "string" && parsed.data.subtitle.trim()
      ? parsed.data.subtitle.trim()
      : undefined;
  const image =
    typeof parsed.data.image === "string" && parsed.data.image.trim()
      ? parsed.data.image.trim()
      : undefined;
  const type = parseWordType(
    typeof parsed.data.type === "string" ? parsed.data.type : folderTypeGuess,
  );
  const visibility = parseNoteVisibility(
    typeof parsed.data.visibility === "string" ? parsed.data.visibility : undefined,
  );
  const tagsRaw = parsed.data.tags;
  const tags = Array.isArray(tagsRaw)
    ? [...new Set(tagsRaw.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
    : parseTags(typeof tagsRaw === "string" ? tagsRaw : undefined);

  return {
    slug,
    title,
    subtitle,
    image,
    type,
    visibility,
    tags,
    featured: parsed.data.featured === true,
    markdown: parsed.content,
    createdAt: toIsoDate(parsed.data.createdAt),
    updatedAt: toIsoDate(parsed.data.updatedAt),
    publishedAt: toIsoDate(parsed.data.publishedAt),
    relPath,
  };
}

function noteFrontmatter(note: {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type: WordType;
  visibility: NoteVisibility;
  tags: string[];
  featured?: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}): Record<string, unknown> {
  return {
    slug: note.slug,
    title: note.title,
    ...(note.subtitle ? { subtitle: note.subtitle } : {}),
    ...(note.image ? { image: note.image } : {}),
    type: note.type,
    visibility: note.visibility,
    ...(note.tags.length > 0 ? { tags: note.tags } : {}),
    ...(note.featured ? { featured: true } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...(note.publishedAt ? { publishedAt: note.publishedAt } : {}),
  };
}

async function cmdWordsCreate(opts: {
  slug: string;
  title: string;
  markdown: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: NoteVisibility;
  tags?: string[];
  featured?: boolean;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}) {
  heading(`Create word: ${opts.slug}`);
  const created = await createWordRecord({
    slug: opts.slug,
    title: opts.title,
    subtitle: opts.subtitle,
    image: opts.image,
    type: opts.type,
    visibility: opts.visibility ?? "private",
    tags: opts.tags,
    featured: opts.featured,
    createdAt: opts.createdAt,
    updatedAt: opts.updatedAt,
    publishedAt: opts.publishedAt,
    markdown: opts.markdown,
  });
  log(green(`✓ Created ${created.meta.slug}`));
  log(dim(`${created.meta.type} · ${created.meta.visibility}`));
  console.log();
}

async function cmdWordsUpload(opts: {
  slug: string;
  file: string;
  title?: string;
  subtitle?: string;
  image?: string;
  type?: WordType;
  visibility?: NoteVisibility;
  tags?: string[];
  featured?: boolean;
}) {
  const abs = path.resolve(opts.file.replace(/^~/, process.env.HOME ?? "~"));
  const markdown = readMarkdownFile(abs);

  const existing = await getWordRecord(opts.slug);
  if (existing) {
    heading(`Update word from markdown file: ${opts.slug}`);
    const updated = await updateWordRecord(opts.slug, {
      title: opts.title,
      subtitle: opts.subtitle,
      image: opts.image,
      type: opts.type,
      visibility: opts.visibility,
      tags: opts.tags,
      featured: opts.featured,
      markdown,
    });
    if (!updated) throw new Error("Failed to update word");
    const unchanged = updated.meta.updatedAt === existing.meta.updatedAt;
    if (unchanged) {
      log(dim(`No changes for ${opts.slug} (already up to date)`));
    } else {
      log(green(`✓ Updated ${opts.slug} from ${abs}`));
    }
    console.log();
    return;
  }

  heading(`Create word from markdown file: ${opts.slug}`);
  await createWordRecord({
    slug: opts.slug,
    title: opts.title ?? opts.slug,
    subtitle: opts.subtitle,
    image: opts.image,
    type: opts.type,
    visibility: opts.visibility ?? "private",
    tags: opts.tags,
    featured: opts.featured,
    markdown,
  });
  log(green(`✓ Created ${opts.slug} from ${abs}`));
  console.log();
}

async function cmdWordsList(opts?: {
  visibility?: NoteVisibility;
  type?: WordType;
  tag?: string;
  q?: string;
}) {
  heading("Words");
  const { words } = await listWordRecords({
    includeNonPublic: true,
    visibility: opts?.visibility,
    type: opts?.type,
    tag: opts?.tag,
    q: opts?.q,
  });
  if (words.length === 0) {
    log(dim("No words found."));
    console.log();
    return;
  }

  for (const word of words) {
    log(
      `${bold(word.slug)} ${dim(`(${word.type} · ${word.visibility}${word.featured ? " · featured" : ""})`)}`,
    );
    log(`  ${word.title}`);
    if (word.subtitle) log(`  ${dim(word.subtitle)}`);
    if (word.tags.length > 0) log(`  ${dim("#" + word.tags.join(" #"))}`);
    log(`  ${dim(new Date(word.updatedAt).toLocaleString())}`);
    console.log();
  }
}

async function cmdWordsUpdate(
  slug: string,
  opts: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: WordType;
    visibility?: NoteVisibility;
    tags?: string[];
    featured?: boolean;
    markdownFile?: string;
  },
) {
  const before = await getWordRecord(slug);
  let markdown: string | undefined;
  if (opts.markdownFile) {
    markdown = readMarkdownFile(opts.markdownFile);
  }

  heading(`Update word: ${slug}`);
  const updated = await updateWordRecord(slug, {
    title: opts.title,
    subtitle: opts.subtitle,
    image: opts.image,
    type: opts.type,
    visibility: opts.visibility,
    tags: opts.tags,
    featured: opts.featured,
    markdown,
  });
  if (!updated) throw new Error(`Word "${slug}" not found`);
  const unchanged = !!before && updated.meta.updatedAt === before.meta.updatedAt;
  if (unchanged) {
    log(dim("No changes (already up to date)"));
  } else {
    log(green("✓ Word updated"));
  }
  console.log();
}

async function cmdWordsDelete(slug: string) {
  heading(`Delete word: ${slug}`);
  const ok = await confirm(`Delete word "${slug}"?`);
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }
  const deleted = await deleteWordRecord(slug);
  if (!deleted) throw new Error(`Word "${slug}" not found`);
  log(green("✓ Word deleted"));
  console.log();
}

async function cmdWordsShareCreate(opts: {
  slug: string;
  expiresInDays?: number;
  pinRequired?: boolean;
  pin?: string;
}) {
  heading(`Create share link: ${opts.slug}`);
  const created = await createWordShare(opts.slug, {
    expiresInDays: opts.expiresInDays,
    pinRequired: opts.pinRequired,
    pin: opts.pin,
  });
  log(green("✓ Share link created"));
  log(`  ${created.url}`);
  console.log();
}

async function cmdWordsShareList(slug: string) {
  heading(`Share links: ${slug}`);
  const links = await listWordShares(slug);
  if (links.length === 0) {
    log(dim("No share links."));
    console.log();
    return;
  }
  for (const link of links) {
    const state = link.revokedAt
      ? "revoked"
      : new Date(link.expiresAt).getTime() <= Date.now()
        ? "expired"
        : "active";
    log(`${bold(link.id)} ${dim(`(${state})`)}`);
    log(`  expires: ${new Date(link.expiresAt).toLocaleString()}`);
    log(`  pin: ${link.pinRequired ? "required" : "off"}`);
    console.log();
  }
}

async function cmdWordsShareUpdate(
  slug: string,
  id: string,
  opts: {
    pinRequired?: boolean;
    pin?: string | null;
    expiresInDays?: number;
    rotateToken?: boolean;
  },
) {
  heading(`Update share link: ${id}`);
  const updated = await updateWordShare(slug, id, opts);
  if (!updated) throw new Error("Share link not found.");
  log(green("✓ Share updated"));
  if (updated.url) {
    log("  New URL:");
    log(`  ${updated.url}`);
  }
  console.log();
}

async function cmdWordsShareRevoke(slug: string, id: string) {
  heading(`Revoke share link: ${id}`);
  const ok = await confirm("Revoke this share link?");
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }
  const revoked = await revokeWordShare(slug, id);
  if (!revoked) throw new Error("Share link not found.");
  log(green("✓ Share revoked"));
  console.log();
}

async function cmdWordsShareCleanup(opts: { slug?: string }) {
  heading(opts.slug ? `Cleanup share links: ${opts.slug}` : "Cleanup share links");
  const result = await cleanupWordShares(opts.slug);
  log(green(`✓ Scanned ${result.scannedLinks} links across ${result.scannedSlugs} slug(s)`));
  log(green(`✓ Removed ${result.removedExpired} expired + ${result.removedRevoked} revoked links`));
  log(green(`✓ Removed ${result.staleIndexRemoved} stale index entries`));
  log(dim(`${result.remaining} active links remain.`));
  console.log();
}

async function cmdWordsSharePurge(opts: { slug?: string; all?: boolean }) {
  if (!opts.slug && !opts.all) {
    throw new Error("Usage: pnpm cli words share purge --slug <slug> | --all");
  }

  heading(opts.slug ? `Purge share links: ${opts.slug}` : "Purge ALL share links");
  log(red("This permanently deletes share link records."));
  console.log();
  const ok = await confirm("Proceed?");
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await purgeWordShares(opts.slug);
  log(green(`✓ Purged ${result.deletedLinks} share link(s) across ${result.scannedSlugs} slug(s)`));
  console.log();
}

async function cmdWordsShareReset(all: boolean) {
  if (!all) {
    throw new Error("Usage: pnpm cli words share reset --all");
  }

  heading("Reset share link state");
  log(red("This is a hard reset and deletes all share links."));
  console.log();
  const ok = await confirm("Reset all share link state?");
  if (!ok) {
    log(dim("Cancelled."));
    console.log();
    return;
  }

  const result = await resetWordShares();
  log(
    green(
      `✓ Reset complete. Removed ${result.deletedLinks} links across ${result.scannedSlugs} slug(s).`,
    ),
  );
  console.log();
}

async function syncSingleNoteFile(
  absFile: string,
  rootDir: string,
): Promise<"created" | "updated" | "skipped"> {
  if (!absFile.endsWith(".md")) return "skipped";
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) return "skipped";

  const input = noteSyncInputFromFile(absFile, rootDir);
  if (!isValidSlug(input.slug)) {
    log(yellow(`skip ${input.relPath} (invalid slug)`));
    return "skipped";
  }

  const existing = await getWordRecord(input.slug);
  const nextType = input.type ?? existing?.meta.type ?? "note";
  const createVisibility = input.visibility ?? "private";

  if (existing) {
    const updated = await updateWordRecord(input.slug, {
      title: input.title,
      subtitle: input.subtitle ?? null,
      image: input.image ?? null,
      type: nextType,
      visibility: input.visibility,
      tags: input.tags,
      featured: input.featured,
      markdown: input.markdown,
    });
    if (!updated) return "skipped";
    if (updated.meta.updatedAt === existing.meta.updatedAt) {
      log(dim(`unchanged ${input.slug}`) + dim(` ← ${input.relPath}`));
      return "skipped";
    }
    log(green(`updated ${input.slug}`) + dim(` ← ${input.relPath}`));
    return "updated";
  }

  await createWordRecord({
    slug: input.slug,
    title: input.title,
    subtitle: input.subtitle,
    image: input.image,
    type: nextType,
    visibility: createVisibility,
    tags: input.tags,
    featured: input.featured,
    markdown: input.markdown,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    publishedAt: input.publishedAt,
  });
  log(green(`created ${input.slug}`) + dim(` ← ${input.relPath}`));
  return "created";
}

async function cmdWordsSync(opts: { dir: string }) {
  const rootDir = path.resolve(opts.dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  heading("Sync words from folder");
  log(dim(rootDir));
  log(dim(`concurrency ${getCliIoConcurrency()}`));
  console.log();

  const files = listMarkdownFiles(rootDir);
  if (files.length === 0) {
    log(dim("No markdown files found."));
    console.log();
    return;
  }

  const results = await mapWithConcurrency(files, getCliIoConcurrency(), async (file) =>
    syncSingleNoteFile(file, rootDir),
  );
  const created = results.filter((result) => result === "created").length;
  const updated = results.filter((result) => result === "updated").length;
  const skipped = results.filter((result) => result === "skipped").length;

  console.log();
  log(green(`✓ synced ${files.length} files`));
  log(dim(`created ${created} · updated ${updated} · skipped ${skipped}`));
  console.log();
}

async function cmdWordsWatch(opts: { dir: string }) {
  const rootDir = path.resolve(opts.dir.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Directory not found: ${rootDir}`);
  }

  await cmdWordsSync({ dir: rootDir });

  heading("Watch mode");
  log(dim(`watching ${rootDir}`));
  log(dim("changes to *.md are synced automatically. press Ctrl+C to stop."));
  console.log();

  const timers = new Map<string, NodeJS.Timeout>();
  const queueSync = (abs: string, debounceMs = 180) => {
    if (!abs.endsWith(".md")) return;
    const prior = timers.get(abs);
    if (prior) clearTimeout(prior);
    timers.set(
      abs,
      setTimeout(() => {
        timers.delete(abs);
        void safely(async () => {
          await syncSingleNoteFile(abs, rootDir);
        });
      }, debounceMs),
    );
  };

  let stopWatching: (() => void) | undefined;

  try {
    const watcher = fs.watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const abs = path.join(rootDir, filename);
      queueSync(abs);
    });
    watcher.on("error", (err) => {
      log(yellow(`watch error: ${(err as Error).message}`));
    });
    stopWatching = () => watcher.close();
  } catch {
    log(
      yellow("Recursive watch unavailable in this environment. Falling back to polling every 2s."),
    );
    const knownMtime = new Map<string, number>();
    for (const file of listMarkdownFiles(rootDir)) {
      const stat = fs.statSync(file);
      knownMtime.set(file, stat.mtimeMs);
    }

    const interval = setInterval(() => {
      const files = listMarkdownFiles(rootDir);
      const seen = new Set(files);

      for (const file of files) {
        let nextMtime: number;
        try {
          nextMtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        const prevMtime = knownMtime.get(file);
        knownMtime.set(file, nextMtime);
        if (prevMtime === undefined || prevMtime !== nextMtime) {
          queueSync(file, 0);
        }
      }

      for (const tracked of knownMtime.keys()) {
        if (!seen.has(tracked)) knownMtime.delete(tracked);
      }
    }, 2000);
    stopWatching = () => clearInterval(interval);
  }

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      stopWatching?.();
      for (const t of timers.values()) clearTimeout(t);
      console.log();
      log(dim("watch stopped"));
      console.log();
      resolve();
    });
  });
}

async function cmdWordsPull(opts: { dir: string; type?: WordType; visibility?: NoteVisibility }) {
  const rootDir = path.resolve(opts.dir.replace(/^~/, process.env.HOME ?? "~"));
  fs.mkdirSync(rootDir, { recursive: true });

  heading("Pull words to folder");
  log(dim(rootDir));
  log(dim(`concurrency ${getCliIoConcurrency()}`));
  console.log();

  const { words } = await listWordRecords({
    includeNonPublic: true,
    type: opts.type,
    visibility: opts.visibility,
    limit: 1000,
  });
  if (words.length === 0) {
    log(dim("No words found."));
    console.log();
    return;
  }

  const writtenResults = await mapWithConcurrency(words, getCliIoConcurrency(), async (word) => {
    const record = await getWordRecord(word.slug);
    if (!record) return "skipped";

    const typeDir = path.join(rootDir, word.type);
    fs.mkdirSync(typeDir, { recursive: true });
    const outPath = path.join(typeDir, `${word.slug}.md`);
    const frontmatter = noteFrontmatter(record.meta);
    const withFrontmatter = matter.stringify(record.markdown, frontmatter);
    if (fs.existsSync(outPath)) {
      try {
        const current = fs.readFileSync(outPath, "utf-8");
        if (current === withFrontmatter) {
          log(dim(`unchanged ${word.type}/${word.slug}.md`));
          return "skipped";
        }
      } catch {
        // Fall through to overwrite when current file is unreadable.
      }
    }
    fs.writeFileSync(outPath, withFrontmatter, "utf-8");
    log(green(`wrote ${word.type}/${word.slug}.md`));
    return "written";
  });
  const written = writtenResults.filter((result) => result === "written").length;
  const skipped = writtenResults.filter((result) => result === "skipped").length;

  console.log();
  log(green(`✓ exported ${written} words`));
  log(dim(`skipped ${skipped} unchanged`));
  console.log();
}

/* ─── Help ─── */

function showHelp() {
  console.log(`
  ${bold("milk & henny")} — content, events, admin API, and storage CLI

  ${bold("Usage")}
    pnpm cli                                  ${dim("Interactive mode (recommended)")}
    pnpm cli help                             ${dim("Show this help")}
    pnpm cli <command> [subcommand] [options] ${dim("Direct command")}

  ${bold("Admin API")}
    admin request ${dim("<method> <path>")}              Call any deployed admin/control route
      --base-url ${dim("<url>")}                         App URL (defaults to VITE_BASE_URL)
      --admin-token ${dim("<jwt>")}                      Use an existing admin JWT
      --admin-password ${dim("<password>")}              Sign in and cache an admin JWT
      --json ${dim("<object>")}                           JSON request body
      --file ${dim("<path>")}                             Read JSON request body from a file
      --step-up                                      Create and send a step-up token
      --step-up-token ${dim("<token>")}                   Send an existing step-up token
      --dry-run                                      Print the mutation without sending it
      --yes                                          Skip the mutation confirmation prompt
    ${dim("Supports every /api/admin/* route, system diagnostics, and best-dressed admin controls without SQL.")}

  ${bold("Events and tickets")}
    events list                                  List events from the deployed app
    events create --json ${dim("<object>")}                  Create an event
    events show ${dim("<slug>")}                           Show event and ticket operations
    events update ${dim("<slug>")} --json ${dim("<object>")}       Patch event settings
    events delete ${dim("<slug>")} --step-up --yes            Delete an event after step-up auth
    events ticket list ${dim("<slug>")}                     List ticket types and sold counts
    events ticket add ${dim("<slug>")}                     Add a ticket type
      --id, --name, --price, --quantity, --per-person-limit
      --description, --currency, --hidden
    events ticket update ${dim("<slug> <ticket-id>")}       Update ticket type fields
      --name, --price, --quantity, --per-person-limit
      --description, --currency, --hidden
    events ticket remove ${dim("<slug> <ticket-id>")}       Remove a ticket type (use --yes)
    ${dim("Mutations ask for confirmation unless --yes or --dry-run is supplied.")}

  ${bold("Albums and photos")} ${dim("(private source storage; explicit publication)")}
    albums list
    albums create --slug ${dim("<slug>")} --title ${dim("<title>")} --date ${dim("<YYYY-MM-DD>")}
    albums update ${dim("<slug>")} ${dim("[--title ...] [--date ...] [--description ...] [--status draft|published]")}
    albums upload ${dim("<slug>")} --dir ${dim("<path>")}
    albums delete ${dim("<slug>")} --yes
    photos add ${dim("<album>")} --dir ${dim("<path>")}
    photos delete ${dim("<album> <photo-id>")} --yes
    photos set-cover ${dim("<album> <photo-id>")}
    photos update ${dim("<album> <photo-id>")} ${dim("[--title ...] [--alt ...] [--caption ...] [--focal ...]")}
    photos reorder ${dim("<album>")} --ids ${dim("<id,id,id>")}

  ${bold("Transfers")} ${dim("(private, self-destructing file shares)")}
    transfers list                           List active transfers + time left
    transfers show ${dim("<id>")}                      Show transfer details + URLs
    transfers info ${dim("<id>")}                      Alias for show
    transfers upload                         Upload new transfer
      --dir ${dim("<path>")}      ${dim("Folder with files (images, videos, PDFs, zips — anything)")}
      --title ${dim("<title>")}   ${dim('Title for the transfer (e.g. "Photos for John")')}
      --expires ${dim("<time>")}  ${dim("Expiry: 30m, 1h, 12h, 1d, 7d, 14d, 30d (default: 7d)")}
      ${dim("If interrupted, rerun the same command in the same folder to auto-resume.")}
    transfers append ${dim("<id>")} --dir ${dim("<path>")}          Add files to an active transfer
    transfers delete-file ${dim("<id>")} --file ${dim("<file-id|filename>")}  Delete one file from a transfer
    transfers delete ${dim("<id>")}                    Take down a transfer + delete R2 files
    transfers media retry ${dim("<id>")} [--file ${dim("<id|filename>")}]  Retry/backfill media for a transfer
    transfers queue status                  Show worker heartbeat + queue length
    transfers queue clear ${dim("[--yes]")}             Delete queued + processing transfer media jobs
    transfers media-status                  Alias for queue status
    transfers media-drain ${dim("[--limit 8]")}            Drain queued worker jobs now
    transfers media-reconcile               Reconcile stale queued/processing transfer states
      ${dim("A blocking media worker requires direct Redis env (REDIS_URL or UPSTASH_REDIS_HOST/PORT/PASSWORD).")}
    transfers cleanup                        Cleanup expired/orphaned transfer storage
    transfers nuke ${dim("[--yes]")}                    Wipe ALL transfers (R2 + Redis) — nuclear option

  ${bold("Words Media")} ${dim("(media for words + shared reusable assets)")}
    media upload --slug ${dim("<word-slug>")} --dir ${dim("<path>")}   Upload to words/media/<slug>/
    media upload --asset ${dim("<asset-id>")} --dir ${dim("<path>")}    Upload to words/assets/<asset-id>/
      --force            ${dim("Re-upload and overwrite existing images")}
    media list --slug ${dim("<word-slug>")}                     List files in words/media/<slug>/
    media list --asset ${dim("<asset-id>")}                     List files in words/assets/<asset-id>/
    media delete --slug ${dim("<word-slug>")} ${dim("[--file <name>]")}     Delete one/all files in words/media/<slug>/
    media delete --asset ${dim("<asset-id>")} ${dim("[--file <name>]")}      Delete one/all files in words/assets/<asset-id>/
    media backfill-images ${dim("[--force]")}                    Backfill AVIF/WebP and placeholders
    media orphans ${dim("[--limit <n>]")}                      Scan orphan words/media folders
    media purge-stale ${dim("[--yes]")}                        Delete orphan words/media folders

  ${bold("Words")} ${dim("(private markdown + signed shares)")}
    words create --slug ${dim("<slug>")} --title ${dim("<title>")} --markdown-file ${dim("<path>")} ${dim("[--subtitle <text>] [--image <path>] [--type blog|note|recipe|review] [--visibility ...] [--tags a,b] [--featured true|false]")}
    words template --out ${dim("<path>")} ${dim("[--title <title>] [--slug <slug>] [--subtitle <text>] [--type ...] [--visibility ...] [--tags a,b] [--overwrite]")}
    words upload --slug ${dim("<slug>")} --file ${dim("<path>")} ${dim("[--title <title>] [--subtitle <text>] [--image <path>] [--type ...] [--visibility ...] [--tags a,b] [--featured true|false]")}
    words list ${dim("[--type blog|note|recipe|review] [--visibility public|unlisted|private] [--tag <tag>] [--q <query>]")}
    words update ${dim("<slug>")} ${dim("[--title <title>] [--subtitle <text>] [--clear-subtitle] [--image <path>|--clear-image] [--type ...] [--visibility ...] [--tags a,b] [--featured true|false] [--markdown-file <path>]")}
    words delete ${dim("<slug>")}
    words pull --dir ${dim("<path>")} ${dim("[--type ...] [--visibility ...]")} ${dim("(remote -> local)")}
    words sync --dir ${dim("<path>")} ${dim("(local -> remote, one-off upload/update from folder)")}
    words watch --dir ${dim("<path>")} ${dim("(local -> remote, sync once then watch local markdown changes)")}
    words share create ${dim("<slug>")} ${dim("[--expires-days 7] [--pin-required] [--pin 1234]")}
    words share list ${dim("<slug>")}
    words share update ${dim("<slug> <share-id>")} ${dim("[--pin-required true|false] [--pin <newPin>|--clear-pin] [--expires-days <n>] [--rotate-token]")}
    words share revoke ${dim("<slug> <share-id>")}
    words share cleanup ${dim("[--slug <slug>]")}
    words share purge ${dim("--slug <slug> | --all")}
    words share reset ${dim("--all")}

  ${bold("Bucket")} ${dim("(raw R2 access)")}
    bucket ls ${dim("[prefix]")}                       Browse bucket contents
    bucket rm ${dim("<key>")}                          Delete a file from bucket
    bucket info                              Show bucket usage & free tier %

  ${bold("Auth")} ${dim("(session security)")}
    auth login ${dim("[--base-url http://localhost:3000]")} ${dim("(opens browser)")}
      ${dim("Use --admin-password only for headless or one-off login.")}
      ${dim("Approve in the browser and store the short-lived admin JWT in the OS credential store.")}
    auth logout ${dim("[--base-url http://localhost:3000]")}
      ${dim("Remove the local CLI JWT. This does not revoke the remote session.")}
    auth revoke ${dim("[--base-url http://localhost:3000]")}
      ${dim("Step up privately, revoke the current CLI session remotely, and remove it locally.")}
    auth revoke --role ${dim("<admin|upload|all>")} ${dim("[--admin-password <password>] [--admin-token <jwt>]")}
      ${dim("Explicitly revoke every session for a role.")}
    auth diagnose ${dim("[--admin-password <password> | --admin-token <jwt>] [--base-url http://localhost:3000]")}
      ${dim("Runs verify + protected-route probes and prints precise auth failure points.")}
    auth sessions ${dim("[--admin-password <password> | --admin-token <jwt>] [--base-url http://localhost:3000]")}
      ${dim("Lists active token sessions (Redis-backed) with status + expiry.")}

  ${bold("Examples")}
    ${dim("$")} pnpm cli
    ${dim("$")} pnpm cli albums create --slug jan-2026 --title "January 2026" --date 2026-01-16
    ${dim("$")} pnpm cli albums upload jan-2026 --dir ~/Desktop/party
    ${dim("$")} pnpm cli transfers upload --dir ~/Desktop/send-photos --title "Photos for John" --expires 7d
    ${dim("   ")} ${dim("(Rerun the same transfers upload command to resume after a network interruption)")}
    ${dim("$")} pnpm cli transfers append velvet-moon-candle --dir ~/Desktop/more-photos
    ${dim("$")} pnpm cli transfers list
    ${dim("$")} pnpm cli transfers show velvet-moon-candle
    ${dim("$")} pnpm cli transfers media retry velvet-moon-candle --file capture
    ${dim("$")} pnpm cli transfers queue status
    ${dim("$")} pnpm cli transfers queue clear --yes
    ${dim("$")} pnpm cli transfers delete abc12345
    ${dim("$")} pnpm cli media upload --slug my-first-birthday --dir ~/Desktop/word-photos
    ${dim("$")} pnpm cli media upload --asset brand-kit --dir ~/Desktop/brand-assets
    ${dim("$")} pnpm cli media list --slug my-first-birthday
    ${dim("$")} pnpm cli media orphans --limit 200
    ${dim("$")} pnpm cli bucket ls words/media/my-first-birthday/
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
  log(dim("Upload any files to a self-destructing shareable link."));
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
    })),
  );

  if (choice <= 0) return null;
  return transfers[choice - 1].id;
}

async function promptTransferAppend(): Promise<void> {
  const id = await selectTransfer();
  if (!id) return;

  const info = await getTransferInfo(id);
  if (!info) {
    log(red(`Transfer "${id}" not found or already expired.`));
    return;
  }

  console.log();
  log(bold(`Add files to: ${info.title}`));
  log(
    dim(`${info.id} · ${info.files.length} files · ${formatDuration(info.remainingSeconds)} left`),
  );
  console.log();

  let dir = "";
  while (true) {
    dir = await ask("Source directory", {
      hint: "e.g. ~/Desktop/more-files-for-this-transfer",
    });
    if (!dir) return;

    const check = validateTransferDir(dir);
    if (check.valid) {
      log(green(`  Found ${check.count} files`));
      break;
    }
    log(red(`  ${check.error}`));
  }

  console.log();
  log(dim("─── Summary ───"));
  log(`${dim("Transfer:")}  ${info.title} (${info.id})`);
  log(`${dim("Directory:")} ${dir}`);
  console.log();

  const ok = await confirm("Append these files to the transfer?");
  if (!ok) {
    log(dim("Cancelled."));
    return;
  }

  await cmdTransfersAppend({
    id,
    dir: dir.replace(/^~/, process.env.HOME ?? "~"),
  });
}

async function interactiveTransfers() {
  while (true) {
    const choice = await choose("Transfers", [
      { label: "List active transfers", detail: "see all + time remaining" },
      { label: "Transfer details", detail: "URLs, photos, expiry" },
      { label: "Create new transfer", detail: "upload files to shareable link" },
      { label: "Add files to transfer", detail: "append files to an active transfer" },
      { label: "Delete a transfer", detail: "take down and remove from R2" },
      { label: "Cleanup expired/orphaned", detail: "remove stale transfer storage only" },
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
        await safely(promptTransferAppend);
        await pause();
        break;
      }
      case 5: {
        const id = await selectTransfer();
        if (id) {
          await safely(() => cmdTransfersDelete(id));
          await pause();
        }
        break;
      }
      case 6:
        await safely(cmdTransfersCleanup);
        await pause();
        break;
      case 7:
        await safely(cmdTransfersNuke);
        await pause();
        break;
    }
  }
}

/* ─── Interactive words media ─── */

/** Interactive prompt for selecting a word slug — shows existing words */
async function selectWordSlugForMedia(prompt = "Word slug"): Promise<string | null> {
  const { words } = await listWordRecords({
    includeNonPublic: true,
    limit: 500,
  });
  const slugs = words.map((word) => word.slug).sort();

  if (slugs.length > 0) {
    console.log();
    log(dim("Existing words:"));
    for (const s of slugs) {
      log(`  ${dim("·")} ${s}`);
    }
    console.log();
  }

  while (true) {
    const slug = await ask(prompt, {
      hint: slugs.length > 0 ? "pick from above or type a new slug" : "e.g. my-first-word",
    });
    if (!slug) return null;
    if (!isValidSlug(slug)) {
      log(red("  Slug must be lowercase letters, numbers, hyphens only."));
      continue;
    }

    // Warn if slug doesn't match any existing word
    if (!slugs.includes(slug)) {
      log(
        yellow(
          `  No existing word found for "${slug}" — media will upload and can be used after creating content with this slug.`,
        ),
      );
    }
    return slug;
  }
}

/** Interactive prompt for uploading words media files */
async function promptWordsMediaUpload(): Promise<void> {
  console.log();
  log(bold("Upload words media"));
  log(dim("Process and upload files from a folder to R2, get markdown snippets."));
  log(dim("Images → WebP. Videos, PDFs, etc. → uploaded as-is."));
  log(dim("Duplicates are skipped automatically — safe to re-run with new files."));
  console.log();

  const scopePick = await choose("Upload target", [
    { label: "Word media", detail: "words/media/<slug>/" },
    { label: "Shared assets", detail: "words/assets/<asset-id>/" },
  ]);
  if (scopePick <= 0) return;

  let target: WordMediaTarget;
  if (scopePick === 1) {
    const slug = await selectWordSlugForMedia();
    if (!slug) return;
    target = { scope: "word", slug };
  } else {
    while (true) {
      const assetId = await ask("Asset ID", { hint: "lowercase letters, numbers, hyphens" });
      if (!assetId) return;
      if (!isValidSlug(assetId)) {
        log(red("  Invalid asset id format."));
        continue;
      }
      target = { scope: "asset", assetId };
      break;
    }
  }

  /* Source directory */
  let dir = "";
  while (true) {
    dir = await ask("Source directory", {
      hint: "e.g. ~/Desktop/words-media",
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
  log(`${dim("Target:")}     ${mediaTargetLabel(target)}`);
  log(`${dim("R2 path:")}    ${mediaTargetPathHint(target)}`);
  log(`${dim("Directory:")}  ${dir}`);
  console.log();

  const ok = await confirm("Upload these files?");
  if (!ok) {
    log(dim("Cancelled."));
    return;
  }

  await cmdWordsMediaUpload({ target, dir: dir.replace(/^~/, process.env.HOME ?? "~") });
}

async function selectWordsMediaTarget(scope: "word" | "asset"): Promise<WordMediaTarget | null> {
  if (scope === "word") {
    const objects = await listObjects("words/media/");
    const slugs = new Set<string>();

    for (const obj of objects) {
      const parts = obj.key.split("/");
      if (parts[0] === "words" && parts[1] === "media" && parts.length >= 4 && parts[2]) {
        slugs.add(parts[2]);
      }
    }

    if (slugs.size === 0) {
      console.log();
      log(dim("No word media found in R2 yet."));
      return null;
    }

    const slugList = [...slugs].sort();
    const choice = await choose(
      "Select word slug",
      slugList.map((s) => ({ label: s })),
    );

    if (choice <= 0) return null;
    return { scope: "word", slug: slugList[choice - 1] };
  }

  const objects = await listObjects("words/assets/");
  const assetIds = new Set<string>();
  for (const obj of objects) {
    const parts = obj.key.split("/");
    if (parts[0] === "words" && parts[1] === "assets" && parts.length >= 4 && parts[2]) {
      assetIds.add(parts[2]);
    }
  }

  if (assetIds.size === 0) {
    console.log();
    log(dim("No shared assets found in R2 yet."));
    return null;
  }

  const idList = [...assetIds].sort();
  const choice = await choose(
    "Select asset id",
    idList.map((id) => ({ label: id })),
  );

  if (choice <= 0) return null;
  return { scope: "asset", assetId: idList[choice - 1] };
}

async function interactiveWordsMedia() {
  while (true) {
    const choice = await choose("Words Media", [
      { label: "Upload files", detail: "word media or shared assets" },
      { label: "List files", detail: "view files for a target" },
      { label: "Delete file(s)", detail: "remove one or all files for a target" },
      { label: "Scan orphan folders", detail: "find words/media/<slug>/ folders with no page" },
      { label: "Purge stale folders", detail: "delete orphan words/media folders" },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1:
        await safely(promptWordsMediaUpload);
        await pause();
        break;
      case 2: {
        const scopePick = await choose("List from", [
          { label: "Word media (words/media/<slug>/)" },
          { label: "Shared assets (words/assets/<asset-id>/)" },
        ]);
        if (scopePick <= 0) break;
        const target = await selectWordsMediaTarget(scopePick === 1 ? "word" : "asset");
        if (target) {
          await safely(() => cmdWordsMediaList(target));
          await pause();
        }
        break;
      }
      case 3: {
        const scopePick = await choose("Delete from", [
          { label: "Word media (words/media/<slug>/)" },
          { label: "Shared assets (words/assets/<asset-id>/)" },
        ]);
        if (scopePick <= 0) break;
        const target = await selectWordsMediaTarget(scopePick === 1 ? "word" : "asset");
        if (target) {
          const files = await listWordMediaFiles(target);
          if (files.length === 0) {
            log(dim("No files found."));
            break;
          }

          const what = await choose(`Delete from ${mediaTargetPathHint(target)}`, [
            { label: "Delete a specific file" },
            { label: "Delete ALL files for this target", detail: red("destructive") },
          ]);

          if (what === 1) {
            const fileChoice = await choose(
              "Select file",
              files.map((f) => ({
                label: f.filename,
                detail: formatBytes(f.size),
              })),
            );
            if (fileChoice > 0) {
              await safely(() => cmdWordsMediaDelete(target, files[fileChoice - 1].filename));
            }
          } else if (what === 2) {
            await safely(() => cmdWordsMediaDelete(target));
          }
          await pause();
        }
        break;
      }
      case 4: {
        const limitRaw = await ask("Max orphan folders to show", { defaultVal: "50" });
        await safely(() => cmdWordsMediaOrphans(limitRaw || "50"));
        await pause();
        break;
      }
      case 5:
        await safely(() => cmdWordsMediaPurgeStale());
        await pause();
        break;
    }
  }
}

/* ─── Interactive: Words ─── */

async function selectWordSlug(
  promptText = "Word slug",
  opts?: { requireNew?: boolean },
): Promise<string | null> {
  const { words } = await listWordRecords({ includeNonPublic: true });
  const existingSlugs = new Set(words.map((w) => w.slug));
  if (words.length > 0) {
    console.log();
    log(dim("Existing words:"));
    for (const word of words.slice(0, 30)) {
      log(`  ${dim("·")} ${word.slug} ${dim(`(${word.visibility})`)}`);
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
    if (opts?.requireNew && existingSlugs.has(slug)) {
      log(yellow("  That slug already exists. Pick a new slug or use Upload/Update."));
      continue;
    }
    return slug;
  }
}

async function promptCreateWordMarkdown(opts: {
  slug: string;
  title: string;
  subtitle?: string;
  type: WordType;
  visibility: NoteVisibility;
  tags?: string[];
}): Promise<string | null> {
  const sourceChoice = await choose("Markdown source", [
    {
      label: "Use existing markdown file",
      detail: "recommended if you've already written your note",
    },
    {
      label: "Create instant template file",
      detail: "generate a starter .md and use it immediately",
    },
    { label: "Use quick starter content", detail: "skip files for now and publish a basic draft" },
  ]);
  if (sourceChoice <= 0) return null;

  if (sourceChoice === 1) {
    while (true) {
      const markdownFile = await ask("Markdown file", { hint: "e.g. ~/Desktop/word.md" });
      if (!markdownFile) return null;
      try {
        return readMarkdownFile(markdownFile);
      } catch (error) {
        log(yellow(`  ${(error as Error).message}`));
        const next = await choose("Markdown file issue", [
          { label: "Try another path" },
          { label: "Create instant template instead" },
          { label: "Use quick starter content instead" },
        ]);
        if (next <= 0) return null;
        if (next === 2) {
          const out = await ask("Template output path", {
            defaultVal: `~/Documents/mh-words/notes/${opts.slug}.md`,
          });
          if (!out) return null;
          try {
            const outPath = await cmdWordsTemplate({
              out,
              title: opts.title,
              slug: opts.slug,
              subtitle: opts.subtitle,
              type: opts.type,
              visibility: opts.visibility,
              tags: opts.tags,
              quiet: true,
            });
            return readMarkdownFile(outPath);
          } catch (templateError) {
            log(red(`  ${(templateError as Error).message}`));
            continue;
          }
        }
        if (next === 3) {
          return `# ${opts.title}\n\nStart writing here.\n`;
        }
      }
    }
  }

  if (sourceChoice === 2) {
    while (true) {
      const out = await ask("Template output path", {
        defaultVal: `~/Documents/mh-words/notes/${opts.slug}.md`,
      });
      if (!out) return null;
      try {
        const outPath = await cmdWordsTemplate({
          out,
          title: opts.title,
          slug: opts.slug,
          subtitle: opts.subtitle,
          type: opts.type,
          visibility: opts.visibility,
          tags: opts.tags,
          quiet: true,
        });
        log(green(`  Template created: ${outPath}`));
        return readMarkdownFile(outPath);
      } catch (error) {
        const message = (error as Error).message;
        log(yellow(`  ${message}`));
        if (!message.startsWith("File already exists:")) continue;
        const next = await choose("Template file exists", [
          { label: "Use existing file as-is" },
          { label: "Overwrite existing file" },
          { label: "Choose another path" },
        ]);
        if (next <= 0) return null;
        if (next === 1) {
          return readMarkdownFile(out);
        }
        if (next === 2) {
          try {
            const outPath = await cmdWordsTemplate({
              out,
              title: opts.title,
              slug: opts.slug,
              subtitle: opts.subtitle,
              type: opts.type,
              visibility: opts.visibility,
              tags: opts.tags,
              overwrite: true,
              quiet: true,
            });
            log(green(`  Template overwritten: ${outPath}`));
            return readMarkdownFile(outPath);
          } catch (overwriteError) {
            log(red(`  ${(overwriteError as Error).message}`));
          }
        }
      }
    }
  }

  return `# ${opts.title}\n\nStart writing here.\n`;
}

async function interactiveWordsContent() {
  while (true) {
    const choice = await choose("Words · Content", [
      { label: "Create word", detail: "guided new entry flow (new slug only)" },
      { label: "Upload markdown file", detail: "create or replace word body from a local file" },
      { label: "List words", detail: "show words and visibility" },
      { label: "Update word", detail: "title/subtitle/visibility/markdown file" },
      { label: "Delete word", detail: "remove a word permanently" },
      { label: "Create markdown template", detail: "generate a starter .md anywhere" },
    ]);
    switch (choice) {
      case 0:
        return;
      case 1: {
        const slug = await selectWordSlug("New word slug", { requireNew: true });
        if (!slug) break;
        const title = await ask("Title");
        if (!title) break;
        const subtitle = await ask("Subtitle (optional)");
        const image = await ask(
          "Hero image path (optional, e.g. words/media/slug/hero.webp or words/assets/kit/hero.webp)",
        );
        const typeChoice = await choose(
          "Type",
          WORD_TYPES.map((type) => ({ label: type })),
        );
        if (typeChoice <= 0) break;
        const type = WORD_TYPES[typeChoice - 1];
        const tagsRaw = await ask("Tags (optional, comma-separated)");
        const visChoice = await choose("Visibility", [
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        if (visChoice <= 0) break;
        const visibility = (["private", "unlisted", "public"] as const)[visChoice - 1];
        const tags = parseTags(tagsRaw);
        const markdown = await promptCreateWordMarkdown({
          slug,
          title,
          subtitle: subtitle || undefined,
          type,
          visibility,
          tags,
        });
        if (!markdown) break;
        await safely(() =>
          cmdWordsCreate({
            slug,
            title,
            markdown,
            subtitle: subtitle || undefined,
            image: image || undefined,
            type,
            visibility,
            tags,
          }),
        );
        await pause();
        break;
      }
      case 2: {
        const slug = await selectWordSlug();
        if (!slug) break;
        const file = await ask("Markdown file path");
        if (!file) break;
        const title = await ask("Title override (optional)");
        const subtitle = await ask("Subtitle override (optional)");
        const image = await ask(
          "Hero image path override (optional, supports words/media or words/assets)",
        );
        const typeChoice = await choose("Type override", [
          { label: "keep existing" },
          ...WORD_TYPES.map((type) => ({ label: type })),
        ]);
        const type = typeChoice <= 1 ? undefined : WORD_TYPES[typeChoice - 2];
        const tagsRaw = await ask("Tags override (optional, comma-separated)");
        const visChoice = await choose("Visibility override", [
          { label: "keep existing" },
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        const visibility =
          visChoice <= 1 ? undefined : (["private", "unlisted", "public"] as const)[visChoice - 2];
        await safely(() =>
          cmdWordsUpload({
            slug,
            file,
            title: title || undefined,
            subtitle: subtitle || undefined,
            image: image || undefined,
            type,
            visibility,
            tags: parseTags(tagsRaw),
          }),
        );
        await pause();
        break;
      }
      case 3:
        await safely(() => cmdWordsList());
        await pause();
        break;
      case 4: {
        const slug = await selectWordSlug();
        if (!slug) break;
        const title = await ask("New title (blank = keep)");
        const subtitle = await ask("New subtitle (blank = keep, --clear not supported here)");
        const image = await ask("New hero image path (blank = keep)");
        const typeChoice = await choose("Type", [
          { label: "keep existing" },
          ...WORD_TYPES.map((type) => ({ label: type })),
        ]);
        const type = typeChoice <= 1 ? undefined : WORD_TYPES[typeChoice - 2];
        const tagsRaw = await ask("Tags (blank = keep, comma-separated)");
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
          cmdWordsUpdate(slug, {
            title: title || undefined,
            subtitle: subtitle || undefined,
            image: image || undefined,
            type,
            tags: parseTags(tagsRaw),
            markdownFile: markdownFile || undefined,
            visibility,
          }),
        );
        await pause();
        break;
      }
      case 5: {
        const slug = await selectWordSlug();
        if (slug) {
          await safely(() => cmdWordsDelete(slug));
          await pause();
        }
        break;
      }
      case 6: {
        const out = await ask("Template output path", {
          defaultVal: "~/Desktop/new-note.md",
          hint: "works with absolute or ~/ paths",
        });
        if (!out) break;
        const title = await ask("Template title (optional)");
        const slug = await ask("Template slug (optional)");
        const subtitle = await ask("Template subtitle (optional)");
        const typeChoice = await choose(
          "Template type",
          WORD_TYPES.map((type) => ({ label: type })),
        );
        if (typeChoice <= 0) break;
        const visChoice = await choose("Template visibility", [
          { label: "private" },
          { label: "unlisted" },
          { label: "public" },
        ]);
        if (visChoice <= 0) break;
        const visibility = (["private", "unlisted", "public"] as const)[visChoice - 1];
        const tagsRaw = await ask("Template tags (optional, comma-separated)");
        await safely(async () => {
          await cmdWordsTemplate({
            out,
            title: title || undefined,
            slug: slug || undefined,
            subtitle: subtitle || undefined,
            type: WORD_TYPES[typeChoice - 1],
            visibility,
            tags: parseTags(tagsRaw),
          });
        });
        await pause();
        break;
      }
    }
  }
}

async function interactiveWordsLocal() {
  while (true) {
    const choice = await choose("Words · Local Sync", [
      {
        label: "Pull words to folder",
        detail: "remote -> local (download latest words as markdown)",
      },
      { label: "Sync folder once", detail: "local -> remote (upload/update from local markdown)" },
      { label: "Watch folder", detail: "local -> remote (live-sync local markdown changes)" },
    ]);
    switch (choice) {
      case 0:
        return;
      case 1: {
        const dir = await ask("Export folder", { defaultVal: "~/Documents/mh-words" });
        const typePick = await choose("Filter type", [
          { label: "all" },
          ...WORD_TYPES.map((type) => ({ label: type })),
        ]);
        const visibilityPick = await choose("Filter visibility", [
          { label: "all" },
          { label: "public" },
          { label: "unlisted" },
          { label: "private" },
        ]);
        const type = typePick <= 1 ? undefined : WORD_TYPES[typePick - 2];
        const visibility =
          visibilityPick <= 1
            ? undefined
            : (["public", "unlisted", "private"] as const)[visibilityPick - 2];
        await safely(() => cmdWordsPull({ dir, type, visibility }));
        await pause();
        break;
      }
      case 2: {
        const dir = await ask("Folder to sync", { defaultVal: "~/Documents/mh-words" });
        await safely(() => cmdWordsSync({ dir }));
        await pause();
        break;
      }
      case 3: {
        const dir = await ask("Folder to watch", { defaultVal: "~/Documents/mh-words" });
        await safely(() => cmdWordsWatch({ dir }));
        await pause();
        break;
      }
    }
  }
}

async function interactiveWordsShares() {
  while (true) {
    const choice = await choose("Words · Share Links", [
      { label: "Create share link", detail: "signed URL, optional PIN" },
      { label: "List share links", detail: "show active/revoked shares for a word" },
      { label: "Update share link", detail: "toggle PIN, rotate token, extend expiry" },
      { label: "Revoke share link", detail: "disable a share URL" },
    ]);
    switch (choice) {
      case 0:
        return;
      case 1: {
        const slug = await selectWordSlug();
        if (!slug) break;
        const withPin = await confirm("Require PIN on this share link?");
        const pin = withPin ? await ask("PIN") : "";
        await safely(() =>
          cmdWordsShareCreate({
            slug,
            pinRequired: withPin,
            pin: withPin ? pin : undefined,
            expiresInDays: 7,
          }),
        );
        await pause();
        break;
      }
      case 2: {
        const slug = await selectWordSlug();
        if (slug) {
          await safely(() => cmdWordsShareList(slug));
          await pause();
        }
        break;
      }
      case 3: {
        const slug = await selectWordSlug();
        if (!slug) break;
        const links = await listWordShares(slug);
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
          })),
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
            cmdWordsShareUpdate(slug, link.id, {
              pinRequired: !link.pinRequired,
              ...(link.pinRequired ? {} : { pin: nextPin || undefined }),
            }),
          );
        } else if (action === 2) {
          const pin = await ask("New PIN");
          if (pin)
            await safely(() => cmdWordsShareUpdate(slug, link.id, { pinRequired: true, pin }));
        } else if (action === 3) {
          await safely(() => cmdWordsShareUpdate(slug, link.id, { pin: null }));
        } else if (action === 4) {
          await safely(() => cmdWordsShareUpdate(slug, link.id, { rotateToken: true }));
        } else if (action === 5) {
          const daysRaw = await ask("Days", { defaultVal: "7" });
          const days = parseInt(daysRaw, 10);
          if (Number.isFinite(days) && days > 0) {
            await safely(() => cmdWordsShareUpdate(slug, link.id, { expiresInDays: days }));
          }
        }
        await pause();
        break;
      }
      case 4: {
        const slug = await selectWordSlug();
        if (!slug) break;
        const links = await listWordShares(slug);
        if (links.length === 0) {
          log(dim("No share links."));
          await pause();
          break;
        }
        const pick = await choose(
          "Revoke which share?",
          links.map((l) => ({ label: l.id })),
        );
        if (pick > 0) {
          await safely(() => cmdWordsShareRevoke(slug, links[pick - 1].id));
          await pause();
        }
        break;
      }
    }
  }
}

async function interactiveWordsMaintenance() {
  while (true) {
    const choice = await choose("Words · Maintenance", [
      { label: "Cleanup stale share links", detail: "remove expired/revoked and stale indices" },
      { label: "Purge share links", detail: "delete share records for one/all slugs" },
      { label: "Reset share link state", detail: "hard reset all share links" },
    ]);
    switch (choice) {
      case 0:
        return;
      case 1: {
        const pick = await choose("Cleanup scope", [
          { label: "All slugs" },
          { label: "Single slug" },
        ]);
        if (pick <= 0) break;
        const slug = pick === 2 ? await selectWordSlug() : null;
        await safely(() => cmdWordsShareCleanup({ slug: slug ?? undefined }));
        await pause();
        break;
      }
      case 2: {
        const pick = await choose("Purge scope", [
          { label: "Single slug", detail: "delete links for one slug" },
          { label: "All slugs", detail: red("destructive") },
        ]);
        if (pick <= 0) break;
        if (pick === 1) {
          const slug = await selectWordSlug();
          if (!slug) break;
          await safely(() => cmdWordsSharePurge({ slug }));
        } else {
          await safely(() => cmdWordsSharePurge({ all: true }));
        }
        await pause();
        break;
      }
      case 3:
        await safely(() => cmdWordsShareReset(true));
        await pause();
        break;
    }
  }
}

async function interactiveWords() {
  while (true) {
    const choice = await choose("Words", [
      { label: "Content", detail: "create, upload, list, update, delete" },
      { label: "Local Sync", detail: "pull, sync once, watch folder" },
      { label: "Share Links", detail: "create/list/update/revoke link access" },
      { label: "Maintenance", detail: "cleanup, purge, reset share state" },
    ]);
    switch (choice) {
      case 0:
        return;
      case 1:
        await interactiveWordsContent();
        break;
      case 2:
        await interactiveWordsLocal();
        break;
      case 3:
        await interactiveWordsShares();
        break;
      case 4:
        await interactiveWordsMaintenance();
        break;
    }
  }
}

async function interactive() {
  console.log();
  log(bold("milk & henny") + dim(" — interactive CLI"));
  log(dim("Navigate with numbers. Press 0 to go back. Ctrl+C to quit."));

  while (true) {
    const choice = await choose("What would you like to do?", [
      { label: "Transfers", detail: "private, self-destructing file shares" },
      { label: "Words Media", detail: "upload/list/delete per-word media + shared assets" },
      { label: "Words", detail: "content, visibility, and signed links" },
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
        await interactiveTransfers();
        break;
      case 2:
        await interactiveWordsMedia();
        break;
      case 3:
        await interactiveWords();
        break;
      case 4:
        await interactiveBucket();
        break;
      case 5:
        await interactiveAuth();
        break;
    }
  }
}

/* ─── Interactive: Auth ─── */

async function promptAdminToken(): Promise<string | null> {
  console.log();
  log(dim("Tip: use this only if you already have a valid admin JWT."));
  const token = await ask("Admin JWT", { hint: "paste the Bearer token (no 'Bearer ' prefix)" });
  return token ? token.trim() : null;
}

async function promptAdminIdentityForSessions(
  baseUrl: string,
): Promise<{ adminPassword?: string; adminToken?: string } | null> {
  const canonicalBaseUrl = await resolveCanonicalBaseUrl(baseUrl);
  if (getCachedAdminToken(baseUrl) || getCachedAdminToken(canonicalBaseUrl)) {
    log(dim("Using cached admin session for this base URL."));
    return {};
  }
  const password = await ask("Admin password", {
    hint: "recommended. leave blank to use a JWT instead",
  });
  if (password.trim()) {
    return { adminPassword: password.trim() };
  }
  const token = await promptAdminToken();
  if (!token) return null;
  return { adminToken: token };
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
      {
        label: "Diagnose admin auth",
        detail: "verify + protected probes with exact failure points",
      },
      { label: "Revoke admin sessions", detail: red("destructive (logs out all admins)") },
      { label: "Revoke all role sessions", detail: red("destructive (staff + upload + admin)") },
    ]);

    switch (choice) {
      case 0:
        return;
      case 1: {
        const baseUrl = await promptBaseUrl();
        const identity = await promptAdminIdentityForSessions(baseUrl);
        if (!identity) break;
        await safely(async () => {
          try {
            await cmdAuthListSessions({ baseUrl, ...identity });
          } catch (error) {
            const hasPassword =
              typeof identity.adminPassword === "string" && identity.adminPassword.length > 0;
            if (hasPassword || !shouldRetryWithFreshAdminToken(error)) {
              throw error;
            }
            const retryPassword = await ask("Admin password", {
              hint: "cached session expired/invalid. enter password to refresh",
            });
            if (!retryPassword.trim()) {
              throw error;
            }
            await cmdAuthListSessions({ baseUrl, adminPassword: retryPassword.trim() });
          }
        });
        await pause();
        break;
      }
      case 2: {
        const baseUrl = await promptBaseUrl();
        const identity = await promptAdminIdentityForSessions(baseUrl);
        if (!identity) break;
        await safely(async () => {
          try {
            await cmdAuthDiagnose({ baseUrl, ...identity });
          } catch (error) {
            const hasPassword =
              typeof identity.adminPassword === "string" && identity.adminPassword.length > 0;
            if (hasPassword || !shouldRetryWithFreshAdminToken(error)) {
              throw error;
            }
            const retryPassword = await ask("Admin password", {
              hint: "cached session expired/invalid. enter password to refresh",
            });
            if (!retryPassword.trim()) {
              throw error;
            }
            await cmdAuthDiagnose({ baseUrl, adminPassword: retryPassword.trim() });
          }
        });
        await pause();
        break;
      }
      case 3: {
        const baseUrl = await promptBaseUrl();
        const password = await ask("Admin password", {
          hint: "step-up confirmation (input visible)",
        });
        if (!password) break;
        await safely(() =>
          cmdAuthRevoke({
            baseUrl,
            adminPassword: password,
            role: "admin",
          }),
        );
        await pause();
        break;
      }
      case 4: {
        const baseUrl = await promptBaseUrl();
        const password = await ask("Admin password", {
          hint: "step-up confirmation (input visible)",
        });
        if (!password) break;
        await safely(() =>
          cmdAuthRevoke({
            baseUrl,
            adminPassword: password,
            role: "all",
          }),
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
    await (async () => {
      switch (command) {
        case "admin": {
          if (subcommand !== "request" && subcommand !== "api") {
            throw new Error(
              "Usage: pnpm cli admin request <GET|POST|PUT|PATCH|DELETE> <path> [--json <object> | --file <path>]",
            );
          }
          const method = args[2];
          const requestPath = args[3];
          if (!method || !requestPath) {
            throw new Error(
              "Usage: pnpm cli admin request <GET|POST|PUT|PATCH|DELETE> <path> [options]",
            );
          }
          return cmdAdminRequest(method, requestPath);
        }
        case "events":
          switch (subcommand) {
            case "list":
              return cmdEventsList();
            case "create":
              return cmdEventsCreate();
            case "show": {
              const slug = args[2];
              if (!slug) throw new Error("Usage: pnpm cli events show <slug>");
              return cmdEventsShow(slug);
            }
            case "update": {
              const slug = args[2];
              if (!slug) throw new Error("Usage: pnpm cli events update <slug> --json <object>");
              return cmdEventsUpdate(slug);
            }
            case "delete": {
              const slug = args[2];
              if (!slug) throw new Error("Usage: pnpm cli events delete <slug> --step-up --yes");
              return cmdEventsDelete(slug);
            }
            case "ticket": {
              const action = args[2];
              const slug = args[3];
              if (!action || !slug) {
                throw new Error(
                  "Usage: pnpm cli events ticket <list|add|update|remove> <slug> [ticket-id] [options]",
                );
              }
              switch (action) {
                case "list":
                  return cmdEventsTicketList(slug);
                case "add":
                  return cmdEventsTicketAdd(slug);
                case "update": {
                  const ticketId = args[4];
                  if (!ticketId) {
                    throw new Error(
                      "Usage: pnpm cli events ticket update <slug> <ticket-id> [options]",
                    );
                  }
                  return cmdEventsTicketUpdate(slug, ticketId);
                }
                case "remove": {
                  const ticketId = args[4];
                  if (!ticketId) {
                    throw new Error(
                      "Usage: pnpm cli events ticket remove <slug> <ticket-id> --yes",
                    );
                  }
                  return cmdEventsTicketRemove(slug, ticketId);
                }
                default:
                  throw new Error(`Unknown ticket action: ${action}`);
              }
            }
            default:
              throw new Error(`Unknown: events ${subcommand ?? ""}. Run 'pnpm cli help'.`);
          }
        case "albums":
        case "photos":
          return runAlbumsCli(command, args);
        case "transfers":
          switch (subcommand) {
            case "list":
              return cmdTransfersList();
            case "show":
            case "info": {
              const id = args[2];
              if (!id) throw new Error("Usage: pnpm cli transfers show <id>");
              return cmdTransfersInfo(id);
            }
            case "upload": {
              const dir = getArg("dir");
              const title = getArg("title");
              const expires = getArg("expires");
              if (!dir || !title) {
                throw new Error(
                  "Usage: pnpm cli transfers upload --dir <path> --title <title> [--expires 7d]",
                );
              }
              return cmdTransfersUpload({ dir, title, expires: expires ?? undefined });
            }
            case "append": {
              const id = args[2];
              const dir = getArg("dir");
              if (!id || !dir) {
                throw new Error("Usage: pnpm cli transfers append <id> --dir <path>");
              }
              return cmdTransfersAppend({ id, dir });
            }
            case "delete": {
              const id = args[2];
              if (!id) throw new Error("Usage: pnpm cli transfers delete <id>");
              return cmdTransfersDelete(id);
            }
            case "delete-file": {
              const id = args[2];
              const file = getArg("file");
              if (!id || !file) {
                throw new Error(
                  "Usage: pnpm cli transfers delete-file <id> --file <file-id|filename>",
                );
              }
              return cmdTransfersDeleteFile(id, file);
            }
            case "cleanup":
              return cmdTransfersCleanup();
            case "queue": {
              const queueCommand = args[2];
              if (queueCommand === "status") return cmdTransfersMediaStatus();
              if (queueCommand === "clear") return cmdTransfersQueueClear(hasFlag("yes"));
              throw new Error("Usage: pnpm cli transfers queue <status|clear> [--yes]");
            }
            case "media": {
              const mediaCommand = args[2];
              if (mediaCommand === "retry") {
                const id = args[3];
                const file = getArg("file");
                if (!id)
                  throw new Error(
                    "Usage: pnpm cli transfers media retry <id> [--file <file-id|filename>]",
                  );
                return cmdTransfersMediaRetry(id, file);
              }
              throw new Error(
                "Usage: pnpm cli transfers media retry <id> [--file <file-id|filename>]",
              );
            }
            case "media-status":
              return cmdTransfersMediaStatus();
            case "media-drain": {
              const limitRaw = getArg("limit");
              const limit = limitRaw ? Number(limitRaw) : 8;
              return cmdTransfersMediaDrain(
                Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8,
              );
            }
            case "media-reconcile":
              return cmdTransfersMediaReconcile();
            case "nuke":
              return hasFlag("yes") ? cmdTransfersNuke(true) : cmdTransfersNuke();
            default:
              throw new Error(`Unknown: transfers ${subcommand ?? ""}. Run 'pnpm cli help'.`);
          }

        case "media":
          switch (subcommand) {
            case "upload": {
              const slug = getArg("slug");
              const assetId = getArg("asset");
              const dir = getArg("dir");
              if (!dir) {
                throw new Error(
                  "Usage: pnpm cli media upload (--slug <word-slug> | --asset <asset-id>) --dir <path> [--force]",
                );
              }
              const target = getMediaTargetFromArgs({
                slug: slug ?? undefined,
                assetId: assetId ?? undefined,
              });
              return cmdWordsMediaUpload({ target, dir, force: hasFlag("force") });
            }
            case "list": {
              const slug = getArg("slug");
              const assetId = getArg("asset");
              const target = getMediaTargetFromArgs({
                slug: slug ?? undefined,
                assetId: assetId ?? undefined,
              });
              return cmdWordsMediaList(target);
            }
            case "delete": {
              const slug = getArg("slug");
              const assetId = getArg("asset");
              const file = getArg("file");
              const target = getMediaTargetFromArgs({
                slug: slug ?? undefined,
                assetId: assetId ?? undefined,
              });
              return cmdWordsMediaDelete(target, file);
            }
            case "backfill-images":
              return cmdWordsMediaBackfillImages(hasFlag("force"));
            case "orphans":
              return cmdWordsMediaOrphans(getArg("limit"));
            case "purge-stale":
              return cmdWordsMediaPurgeStale(hasFlag("yes"));
            default:
              throw new Error(`Unknown: media ${subcommand ?? ""}. Run 'pnpm cli help'.`);
          }

        case "words":
          switch (subcommand) {
            case "create": {
              const slug = getArg("slug");
              const title = getArg("title");
              const markdownFile = getArg("markdown-file");
              const subtitle = getArg("subtitle");
              const image = getArg("image");
              const type = parseWordType(getArg("type"));
              const visibility = parseNoteVisibility(getArg("visibility"));
              const tags = parseTags(getArg("tags"));
              const featured = parseBooleanInput(getArg("featured"));
              if (!slug || !title || !markdownFile) {
                throw new Error(
                  "Usage: pnpm cli words create --slug <slug> --title <title> --markdown-file <path> [--subtitle <text>] [--image <path>] [--type blog|note|recipe|review] [--visibility public|unlisted|private] [--tags a,b] [--featured true|false]",
                );
              }
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              if (getArg("featured") && featured === undefined)
                throw new Error("Invalid --featured value. Use true/false.");
              const markdown = readMarkdownFile(markdownFile);
              return cmdWordsCreate({
                slug,
                title,
                subtitle,
                image,
                type,
                visibility,
                tags,
                featured,
                markdown,
              });
            }
            case "upload": {
              const slug = getArg("slug");
              const file = getArg("file");
              const title = getArg("title");
              const subtitle = getArg("subtitle");
              const image = getArg("image");
              const type = parseWordType(getArg("type"));
              const visibility = parseNoteVisibility(getArg("visibility"));
              const tags = parseTags(getArg("tags"));
              const featured = parseBooleanInput(getArg("featured"));
              if (!slug || !file) {
                throw new Error(
                  "Usage: pnpm cli words upload --slug <slug> --file <path> [--title <title>] [--subtitle <text>] [--image <path>] [--type blog|note|recipe|review] [--visibility public|unlisted|private] [--tags a,b] [--featured true|false]",
                );
              }
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              if (getArg("featured") && featured === undefined)
                throw new Error("Invalid --featured value. Use true/false.");
              return cmdWordsUpload({
                slug,
                file,
                title: title ?? undefined,
                subtitle: subtitle ?? undefined,
                image: image ?? undefined,
                type,
                visibility,
                tags,
                featured,
              });
            }
            case "list": {
              const visibility = parseNoteVisibility(getArg("visibility"));
              const type = parseWordType(getArg("type"));
              const tag = getArg("tag");
              const q = getArg("q");
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              return cmdWordsList({ visibility, type, tag: tag ?? undefined, q });
            }
            case "update": {
              const slug = args[2];
              if (!slug) {
                throw new Error(
                  "Usage: pnpm cli words update <slug> [--title <title>] [--subtitle <text>] [--clear-subtitle] [--image <path>|--clear-image] [--type blog|note|recipe|review] [--visibility public|unlisted|private] [--tags a,b] [--featured true|false] [--markdown-file <path>]",
                );
              }
              const title = getArg("title");
              const subtitle = hasFlag("clear-subtitle") ? null : (getArg("subtitle") ?? undefined);
              const image = hasFlag("clear-image") ? null : (getArg("image") ?? undefined);
              const type = parseWordType(getArg("type"));
              const visibility = parseNoteVisibility(getArg("visibility"));
              const tags = parseTags(getArg("tags"));
              const featured = parseBooleanInput(getArg("featured"));
              const markdownFile = getArg("markdown-file");
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              if (getArg("featured") && featured === undefined)
                throw new Error("Invalid --featured value. Use true/false.");
              if (
                !title &&
                subtitle === undefined &&
                image === undefined &&
                !type &&
                !visibility &&
                !tags &&
                featured === undefined &&
                !markdownFile &&
                !hasFlag("clear-subtitle") &&
                !hasFlag("clear-image")
              ) {
                throw new Error("Nothing to update.");
              }
              return cmdWordsUpdate(slug, {
                title: title ?? undefined,
                subtitle,
                image,
                type,
                visibility,
                tags,
                featured,
                markdownFile: markdownFile ?? undefined,
              });
            }
            case "delete": {
              const slug = args[2];
              if (!slug) throw new Error("Usage: pnpm cli words delete <slug>");
              return cmdWordsDelete(slug);
            }
            case "pull": {
              const dir = getArg("dir");
              const type = parseWordType(getArg("type"));
              const visibility = parseNoteVisibility(getArg("visibility"));
              if (!dir) {
                throw new Error(
                  "Usage: pnpm cli words pull --dir <path> [--type blog|note|recipe|review] [--visibility public|unlisted|private]",
                );
              }
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              return cmdWordsPull({ dir, type, visibility });
            }
            case "sync": {
              const dir = getArg("dir");
              if (!dir) throw new Error("Usage: pnpm cli words sync --dir <path>");
              return cmdWordsSync({ dir });
            }
            case "watch": {
              const dir = getArg("dir");
              if (!dir) throw new Error("Usage: pnpm cli words watch --dir <path>");
              return cmdWordsWatch({ dir });
            }
            case "template": {
              const out = getArg("out") ?? getArg("file");
              const title = getArg("title");
              const slug = getArg("slug");
              const subtitle = getArg("subtitle");
              const type = parseWordType(getArg("type"));
              const visibility = parseNoteVisibility(getArg("visibility"));
              const tags = parseTags(getArg("tags"));
              if (!out) {
                throw new Error(
                  "Usage: pnpm cli words template --out <path> [--title <title>] [--slug <slug>] [--subtitle <text>] [--type blog|note|recipe|review] [--visibility public|unlisted|private] [--tags a,b] [--overwrite]",
                );
              }
              if (getArg("type") && !type) throw new Error("Invalid --type value.");
              return cmdWordsTemplate({
                out,
                title: title ?? undefined,
                slug: slug ?? undefined,
                subtitle: subtitle ?? undefined,
                type,
                visibility,
                tags,
                overwrite: hasFlag("overwrite"),
              });
            }
            case "share": {
              const action = args[2];
              if (action === "create") {
                const slug = args[3];
                if (!slug)
                  throw new Error(
                    "Usage: pnpm cli words share create <slug> [--expires-days 7] [--pin-required] [--pin 1234]",
                  );
                const expiresDaysRaw = getArg("expires-days");
                const expiresInDays = expiresDaysRaw ? parseInt(expiresDaysRaw, 10) : undefined;
                return cmdWordsShareCreate({
                  slug,
                  expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : undefined,
                  pinRequired: hasFlag("pin-required"),
                  pin: getArg("pin"),
                });
              }
              if (action === "list") {
                const slug = args[3];
                if (!slug) throw new Error("Usage: pnpm cli words share list <slug>");
                return cmdWordsShareList(slug);
              }
              if (action === "update") {
                const slug = args[3];
                const id = args[4];
                if (!slug || !id) {
                  throw new Error(
                    "Usage: pnpm cli words share update <slug> <share-id> [--pin-required true|false] [--pin <newPin>|--clear-pin] [--expires-days <n>] [--rotate-token]",
                  );
                }
                const pinRequiredArg = getArg("pin-required");
                const pinRequired =
                  pinRequiredArg === undefined ? undefined : parseBooleanInput(pinRequiredArg);
                if (pinRequiredArg !== undefined && pinRequired === undefined) {
                  throw new Error("Invalid --pin-required value. Use true/false.");
                }
                const expiresDaysRaw = getArg("expires-days");
                const expiresInDays = expiresDaysRaw ? parseInt(expiresDaysRaw, 10) : undefined;
                const pin = hasFlag("clear-pin") ? null : (getArg("pin") ?? undefined);
                return cmdWordsShareUpdate(slug, id, {
                  pinRequired,
                  pin,
                  expiresInDays: Number.isFinite(expiresInDays) ? expiresInDays : undefined,
                  rotateToken: hasFlag("rotate-token"),
                });
              }
              if (action === "revoke") {
                const slug = args[3];
                const id = args[4];
                if (!slug || !id)
                  throw new Error("Usage: pnpm cli words share revoke <slug> <share-id>");
                return cmdWordsShareRevoke(slug, id);
              }
              if (action === "cleanup") {
                const slug = getArg("slug") ?? args[3];
                return cmdWordsShareCleanup({ slug: slug ?? undefined });
              }
              if (action === "purge") {
                const slug = getArg("slug") ?? args[3];
                return cmdWordsSharePurge({ slug: slug ?? undefined, all: hasFlag("all") });
              }
              if (action === "reset") {
                return cmdWordsShareReset(hasFlag("all"));
              }
              throw new Error(`Unknown words share action: ${action ?? ""}`);
            }
            default:
              throw new Error(`Unknown: words ${subcommand ?? ""}. Run 'pnpm cli help'.`);
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
            case "login": {
              const baseUrl = getArg("base-url");
              const adminPassword = getArg("admin-password");
              return cmdAuthLogin({ baseUrl: baseUrl ?? undefined, adminPassword });
            }
            case "logout": {
              const baseUrl = getArg("base-url");
              return cmdAuthLogout({ baseUrl: baseUrl ?? undefined });
            }
            case "diagnose": {
              const adminToken = getArg("admin-token");
              const adminPassword = getArg("admin-password");
              const baseUrl = getArg("base-url");
              return cmdAuthDiagnose({
                adminToken: adminToken ?? undefined,
                adminPassword: adminPassword ?? undefined,
                baseUrl: baseUrl ?? undefined,
              });
            }
            case "revoke": {
              const adminToken = getArg("admin-token");
              const adminPassword = getArg("admin-password");
              const roleValue = getArg("role");
              const baseUrl = getArg("base-url");
              if (roleValue && !REVOKE_ROLES.includes(roleValue as RevokeRole)) {
                throw new Error(`Invalid role. Use: ${REVOKE_ROLES.join(", ")}`);
              }
              return cmdAuthRevoke({
                adminToken,
                adminPassword: adminPassword ?? undefined,
                role: roleValue as RevokeRole | undefined,
                baseUrl: baseUrl ?? undefined,
              });
            }
            case "sessions": {
              const adminToken = getArg("admin-token");
              const adminPassword = getArg("admin-password");
              const baseUrl = getArg("base-url");
              return cmdAuthListSessions({
                adminToken: adminToken ?? undefined,
                adminPassword: adminPassword ?? undefined,
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
    })();
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
