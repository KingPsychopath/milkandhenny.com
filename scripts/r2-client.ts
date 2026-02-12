/**
 * R2/S3 client and bucket-level operations.
 *
 * Reusable in CLI, scripts, or future API routes.
 * All functions return structured data — no console output.
 */

import fs from "fs";
import path from "path";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  HeadObjectCommand,
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

/* ─── Types ─── */

type R2Object = {
  key: string;
  size: number;
  lastModified: Date | undefined;
};

type BucketInfo = {
  totalObjects: number;
  totalSizeBytes: number;
  totalSizeMB: string;
};

/* ─── Client singleton ─── */

let _client: S3Client | null = null;
let _bucket = "";

function getEnv() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY;
  const secretKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKey || !secretKey || !bucket) {
    throw new Error(
      "Missing env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET in .env.local"
    );
  }

  return { accountId, accessKey, secretKey, bucket };
}

function getClient(): { client: S3Client; bucket: string } {
  if (_client) return { client: _client, bucket: _bucket };

  const env = getEnv();
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.accessKey,
      secretAccessKey: env.secretKey,
    },
  });
  _bucket = env.bucket;

  return { client: _client, bucket: _bucket };
}

/* ─── Bucket operations ─── */

/** List objects under a prefix. Pass empty string for root. */
async function listObjects(prefix = ""): Promise<R2Object[]> {
  const { client, bucket } = getClient();
  const objects: R2Object[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of res.Contents ?? []) {
      objects.push({
        key: obj.Key ?? "",
        size: obj.Size ?? 0,
        lastModified: obj.LastModified,
      });
    }

    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

/** Check if an object exists and get its metadata. */
async function headObject(
  key: string
): Promise<{ exists: boolean; size?: number; contentType?: string }> {
  const { client, bucket } = getClient();

  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    return {
      exists: true,
      size: res.ContentLength,
      contentType: res.ContentType,
    };
  } catch {
    return { exists: false };
  }
}

/** Upload a buffer to the bucket. */
async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

/** Delete a single object. */
async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key })
  );
}

/** Delete multiple objects at once (max 1000 per call). */
async function deleteObjects(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;

  const { client, bucket } = getClient();
  let deleted = 0;

  /* R2/S3 allows max 1000 per batch */
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );

    deleted += batch.length;
  }

  return deleted;
}

/** Get bucket usage stats. */
async function getBucketInfo(): Promise<BucketInfo> {
  const objects = await listObjects("");
  const totalSizeBytes = objects.reduce((sum, o) => sum + o.size, 0);

  return {
    totalObjects: objects.length,
    totalSizeBytes,
    totalSizeMB: (totalSizeBytes / 1024 / 1024).toFixed(2),
  };
}

export {
  listObjects,
  headObject,
  uploadBuffer,
  deleteObject,
  deleteObjects,
  getBucketInfo,
};

export type { R2Object, BucketInfo };
