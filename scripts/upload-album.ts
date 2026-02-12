/**
 * Upload album script.
 *
 * Usage:
 *   npx tsx scripts/upload-album.ts \
 *     --dir ~/Desktop/party-photos \
 *     --slug milk-and-henny-jan-2026 \
 *     --title "Milk & Henny — January 2026" \
 *     --date 2026-01-16 \
 *     --description "The first ever birthday"
 *
 * What it does:
 *   1. Reads all JPG/PNG files from --dir
 *   2. Generates thumb (600px) and full (1600px) versions
 *   3. Uploads original, full, and thumb to R2
 *   4. Writes content/albums/{slug}.json with photo metadata
 *
 * Env vars required (in .env.local):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL
 */

import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

/* ─── Load .env.local ─── */
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

/* ─── Parse CLI args ─── */
function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const dir = getArg("dir");
const slug = getArg("slug");
const title = getArg("title");
const date = getArg("date");
const description = getArg("description");

if (!dir || !slug || !title || !date) {
  console.error("Usage: npx tsx scripts/upload-album.ts --dir <path> --slug <slug> --title <title> --date <YYYY-MM-DD> [--description <desc>]");
  process.exit(1);
}

/* ─── Env ─── */
const accountId = process.env.R2_ACCOUNT_ID;
const accessKey = process.env.R2_ACCESS_KEY;
const secretKey = process.env.R2_SECRET_KEY;
const bucket = process.env.R2_BUCKET;

if (!accountId || !accessKey || !secretKey || !bucket) {
  console.error("Missing env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET in .env.local");
  process.exit(1);
}

/* ─── S3 client (R2-compatible) ─── */
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
  },
});

/* ─── Image sizes ─── */
const THUMB_WIDTH = 600;
const FULL_WIDTH = 1600;

type PhotoMeta = {
  id: string;
  width: number;
  height: number;
};

async function uploadBuffer(key: string, buffer: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

async function processPhoto(filePath: string): Promise<PhotoMeta> {
  const ext = path.extname(filePath).toLowerCase();
  const id = path.basename(filePath, ext);
  const raw = fs.readFileSync(filePath);

  const metadata = await sharp(raw).metadata();
  const origWidth = metadata.width ?? 4032;
  const origHeight = metadata.height ?? 3024;

  console.log(`  Processing ${id} (${origWidth}x${origHeight})...`);

  /* Generate sizes — WebP for viewing (smaller), JPEG for downloads (universal) */
  const thumb = await sharp(raw).resize(THUMB_WIDTH).webp({ quality: 80 }).toBuffer();
  const full = await sharp(raw).resize(FULL_WIDTH).webp({ quality: 85 }).toBuffer();
  const original = ext === ".jpg" || ext === ".jpeg"
    ? raw
    : await sharp(raw).jpeg({ quality: 95 }).toBuffer();

  /* Upload */
  const prefix = `albums/${slug}`;
  await Promise.all([
    uploadBuffer(`${prefix}/thumb/${id}.webp`, thumb, "image/webp"),
    uploadBuffer(`${prefix}/full/${id}.webp`, full, "image/webp"),
    uploadBuffer(`${prefix}/original/${id}.jpg`, original, "image/jpeg"),
  ]);

  console.log(`  ✓ ${id} uploaded`);

  return { id, width: origWidth, height: origHeight };
}

async function main() {
  const absDir = path.resolve(dir!);
  if (!fs.existsSync(absDir)) {
    console.error(`Directory not found: ${absDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(absDir)
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.error("No image files found in directory.");
    process.exit(1);
  }

  console.log(`Found ${files.length} photos. Uploading to R2...`);

  const photos: PhotoMeta[] = [];
  for (const file of files) {
    const meta = await processPhoto(path.join(absDir, file));
    photos.push(meta);
  }

  /* Write album JSON */
  const albumData = {
    title,
    date,
    ...(description ? { description } : {}),
    cover: photos[0].id,
    photos,
  };

  const outPath = path.join(process.cwd(), "content", "albums", `${slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(albumData, null, 2) + "\n");

  console.log(`\n✓ Album metadata written to ${outPath}`);
  console.log(`✓ ${photos.length} photos uploaded to R2`);
  console.log(`\nNext: commit the JSON and deploy.`);
}

main().catch((err) => {
  console.error("Upload failed:", err);
  process.exit(1);
});
