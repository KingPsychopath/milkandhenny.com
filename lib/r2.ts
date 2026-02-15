/**
 * R2/S3 storage client.
 *
 * Runtime-agnostic — reads env vars that Next.js or a script bootstrap provides.
 * All functions return structured data, no console output.
 *
 * To add a new operation: add it here, export it, done.
 * Scripts get env via `scripts/env.ts` (side-effect import), then
 * import operations directly from this module.
 * API routes import directly — Next.js provides env vars.
 */

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
      "Missing R2 env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET."
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

/* ─── Preflight ─── */

/** Check whether all R2 env vars are present (does not create a client). */
function isConfigured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY &&
    process.env.R2_BUCKET
  );
}

/* ─── Operations ─── */

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

/**
 * List immediate sub-prefixes under a prefix (like listing directories).
 * Returns the full prefix strings (e.g. "transfers/abc123/").
 */
async function listPrefixes(prefix: string): Promise<string[]> {
  const { client, bucket } = getClient();
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );

    for (const cp of res.CommonPrefixes ?? []) {
      if (cp.Prefix) prefixes.push(cp.Prefix);
    }

    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return prefixes;
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

/** Download an object as a Buffer. Throws if not found. */
async function downloadBuffer(key: string): Promise<Buffer> {
  const { client, bucket } = getClient();

  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  if (!res.Body) {
    throw new Error(`Object ${key} has no body`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

/**
 * Generate a presigned PUT URL for direct browser-to-R2 upload.
 * Bypasses Vercel's 4.5 MB request body limit entirely.
 *
 * @param key         - R2 object key (e.g. "transfers/abc/original/photo.jpg")
 * @param contentType - MIME type the client will send
 * @param expiresIn   - URL validity in seconds (default 900 = 15 min)
 */
async function presignPutUrl(
  key: string,
  contentType: string,
  expiresIn = 900
): Promise<string> {
  const { client, bucket } = getClient();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export {
  isConfigured,
  listObjects,
  listPrefixes,
  headObject,
  downloadBuffer,
  uploadBuffer,
  deleteObject,
  deleteObjects,
  getBucketInfo,
  presignPutUrl,
};

export type { R2Object, BucketInfo };
