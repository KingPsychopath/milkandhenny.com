/**
 * R2/S3 storage client.
 *
 * Runtime-agnostic — reads env vars that TanStack Start or a script bootstrap provides.
 * All functions return structured data, no console output.
 *
 * To add a new operation: add it here, export it, done.
 * Scripts get env via `scripts/env.ts` (side-effect import), then
 * import operations directly from this module.
 * API routes import directly — the server runtime provides env vars.
 */

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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

type RetryableR2Error = {
  name?: string;
  code?: string;
  Code?: string;
  message?: string;
  $retryable?: unknown;
  $metadata?: { httpStatusCode?: number };
  cause?: unknown;
};

type R2RuntimeConfig = {
  accountId: string;
  accessKey: string;
  secretKey: string;
  publicBucket: string;
  transferBucket?: string;
  maxSockets: number;
  socketAcquisitionWarningTimeoutMs: number;
};

type R2ClientState = {
  client: S3Client;
  configKey: string;
};

type StorageScope = "public" | "private";

type R2OperationOptions = {
  scope?: StorageScope;
};

/* ─── Client singleton ─── */

const R2_RETRIES = Math.max(0, Math.floor(Number(process.env.R2_RETRIES ?? "4")));
const R2_RETRY_BASE_DELAY_MS = Math.max(
  0,
  Math.floor(Number(process.env.R2_RETRY_BASE_DELAY_MS ?? "400")),
);

const globalForR2 = globalThis as typeof globalThis & {
  __partyGuestListR2ClientState__?: R2ClientState;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getDefaultMaxSockets(): number {
  const configuredConcurrency = process.env.MEDIA_WORKER_CONCURRENCY;
  if (!configuredConcurrency) return 50;
  const workerConcurrency = parsePositiveInt(configuredConcurrency, 1);
  return Math.min(200, Math.max(50, workerConcurrency * 3));
}

function getRuntimeConfig(): R2RuntimeConfig {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY;
  const secretKey = process.env.R2_SECRET_KEY;
  const publicBucket = process.env.R2_PUBLIC_BUCKET?.trim() || process.env.R2_BUCKET;
  const transferBucket = process.env.R2_PRIVATE_BUCKET?.trim() || undefined;

  if (!accountId || !accessKey || !secretKey || !publicBucket) {
    throw new Error(
      "Missing R2 env vars. Set R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, and R2_PUBLIC_BUCKET.",
    );
  }

  return {
    accountId,
    accessKey,
    secretKey,
    publicBucket,
    transferBucket,
    maxSockets: parsePositiveInt(process.env.R2_MAX_SOCKETS, getDefaultMaxSockets()),
    socketAcquisitionWarningTimeoutMs: parsePositiveInt(
      process.env.R2_SOCKET_ACQUISITION_WARNING_TIMEOUT_MS,
      10_000,
    ),
  };
}

function getClient(): { client: S3Client; config: R2RuntimeConfig } {
  const config = getRuntimeConfig();
  const configKey = JSON.stringify(config);
  const cached = globalForR2.__partyGuestListR2ClientState__;

  if (cached && cached.configKey === configKey) {
    return { client: cached.client, config };
  }

  cached?.client.destroy();

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: {
        keepAlive: true,
        maxSockets: config.maxSockets,
      },
      socketAcquisitionWarningTimeout: config.socketAcquisitionWarningTimeoutMs,
    }),
  });
  globalForR2.__partyGuestListR2ClientState__ = {
    client,
    configKey,
  };

  return { client, config };
}

function getStorageScope(keyOrPrefix: string): StorageScope {
  return keyOrPrefix === "transfers" || keyOrPrefix.startsWith("transfers/") ? "private" : "public";
}

function getBucket(scope: StorageScope): string {
  const { config } = getClient();
  if (scope === "public") return config.publicBucket;
  if (!config.transferBucket) {
    throw new Error("Private transfer storage is not configured. Set R2_PRIVATE_BUCKET.");
  }
  return config.transferBucket;
}

function getBucketForKey(keyOrPrefix: string, options?: R2OperationOptions): string {
  return getBucket(options?.scope ?? getStorageScope(keyOrPrefix));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorText(err: RetryableR2Error): string {
  const causeMsg =
    typeof err.cause === "object" &&
    err.cause &&
    "message" in (err.cause as Record<string, unknown>)
      ? String((err.cause as { message?: unknown }).message ?? "")
      : "";
  return [err.name, err.code, err.Code, err.message, causeMsg]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isNotFoundR2Error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as RetryableR2Error;
  if (err.$metadata?.httpStatusCode === 404) return true;
  const text = getErrorText(err);
  return text.includes("notfound") || text.includes("no such key");
}

function isTransientR2Error(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as RetryableR2Error;

  if (err.$retryable) return true;

  const status = err.$metadata?.httpStatusCode;
  if (status === 408 || status === 425 || status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;

  const text = getErrorText(err);
  if (!text) return false;

  return [
    "ssl/tls alert bad record mac",
    "bad record mac",
    "econnreset",
    "econnaborted",
    "etimedout",
    "timeout",
    "socket hang up",
    "ehostunreach",
    "enetunreach",
    "eai_again",
    "network error",
    "tls",
  ].some((token) => text.includes(token));
}

async function sendWithRetry<T>(operation: string, send: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= R2_RETRIES; attempt++) {
    try {
      return await send();
    } catch (error) {
      lastError = error;
      if (attempt === R2_RETRIES || !isTransientR2Error(error)) throw error;
      const jitterMs = Math.floor(Math.random() * 120);
      const delayMs = Math.pow(2, attempt) * R2_RETRY_BASE_DELAY_MS + jitterMs;
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error(`R2 ${operation} failed after retries`);
}

/* ─── Preflight ─── */

/** Check whether all R2 env vars are present (does not create a client). */
function isConfigured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY &&
    (process.env.R2_PUBLIC_BUCKET || process.env.R2_BUCKET)
  );
}

function isTransferStorageConfigured(): boolean {
  return isConfigured() && Boolean(process.env.R2_PRIVATE_BUCKET?.trim());
}

/** Lightweight authenticated dependency probe for admin diagnostics. */
async function checkConnection(): Promise<void> {
  const { client, config } = getClient();
  const buckets = [config.publicBucket, config.transferBucket].filter((bucket): bucket is string =>
    Boolean(bucket),
  );
  await Promise.all(
    buckets.map((bucket) =>
      sendWithRetry("checkConnection", () =>
        client.send(new HeadBucketCommand({ Bucket: bucket })),
      ),
    ),
  );
}

/* ─── Operations ─── */

/** List objects under a prefix. Pass empty string for root. */
async function listObjects(prefix = "", options?: R2OperationOptions): Promise<R2Object[]> {
  const { client } = getClient();
  const bucket = getBucketForKey(prefix, options);
  const objects: R2Object[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await sendWithRetry("listObjects", () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix || undefined,
          ContinuationToken: continuationToken,
        }),
      ),
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
async function listPrefixes(prefix: string, options?: R2OperationOptions): Promise<string[]> {
  const { client } = getClient();
  const bucket = getBucketForKey(prefix, options);
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await sendWithRetry("listPrefixes", () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
        }),
      ),
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
  key: string,
  options?: R2OperationOptions,
): Promise<{ exists: boolean; size?: number; contentType?: string }> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  try {
    const res = await sendWithRetry("headObject", () =>
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    );
    return {
      exists: true,
      size: res.ContentLength,
      contentType: res.ContentType,
    };
  } catch (error) {
    if (!isNotFoundR2Error(error)) throw error;
    return { exists: false };
  }
}

/** Download an object as a Buffer. Throws if not found. */
async function downloadBuffer(key: string, options?: R2OperationOptions): Promise<Buffer> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  const res = await sendWithRetry("downloadBuffer", () =>
    client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
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
  contentType: string,
  options?: R2OperationOptions,
): Promise<void> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  await sendWithRetry("uploadBuffer", () =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    ),
  );
}

/** Delete a single object. */
async function deleteObject(key: string, options?: R2OperationOptions): Promise<void> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  await sendWithRetry("deleteObject", () =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  );
}

/** Delete multiple objects at once (max 1000 per call). */
async function deleteObjects(keys: string[], options?: R2OperationOptions): Promise<number> {
  if (keys.length === 0) return 0;

  const { client } = getClient();
  let deleted = 0;
  const keysByScope = new Map<StorageScope, string[]>();

  for (const key of keys) {
    const scope = options?.scope ?? getStorageScope(key);
    const scopedKeys = keysByScope.get(scope) ?? [];
    scopedKeys.push(key);
    keysByScope.set(scope, scopedKeys);
  }

  for (const [scope, scopedKeys] of keysByScope) {
    const bucket = getBucket(scope);
    for (let i = 0; i < scopedKeys.length; i += 1000) {
      const batch = scopedKeys.slice(i, i + 1000);

      const response = await sendWithRetry("deleteObjects", () =>
        client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        ),
      );

      if ((response.Errors?.length ?? 0) > 0) {
        const failedKeys = response.Errors?.map((error) => error.Key).filter(Boolean) ?? [];
        throw new Error(
          `R2 delete failed for ${response.Errors?.length ?? 0} object(s): ${failedKeys.join(", ")}`,
        );
      }

      deleted += batch.length;
    }
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
 * Bypasses application-server request body limits entirely.
 *
 * @param key         - R2 object key (e.g. "transfers/abc/original/photo.jpg")
 * @param contentType - MIME type the client will send
 * @param expiresIn   - URL validity in seconds (default 900 = 15 min)
 */
async function presignPutUrl(
  key: string,
  contentType: string,
  expiresIn = 900,
  options?: R2OperationOptions,
): Promise<string> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

async function presignGetUrl(
  key: string,
  options?: {
    responseContentDisposition?: string;
    responseContentType?: string;
    expiresIn?: number;
    scope?: StorageScope;
  },
): Promise<string> {
  const { client } = getClient();
  const bucket = getBucketForKey(key, options);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentDisposition: options?.responseContentDisposition,
    ResponseContentType: options?.responseContentType,
  });

  return getSignedUrl(client, command, { expiresIn: options?.expiresIn ?? 300 });
}

export {
  checkConnection,
  isConfigured,
  isTransferStorageConfigured,
  listObjects,
  listPrefixes,
  headObject,
  downloadBuffer,
  uploadBuffer,
  deleteObject,
  deleteObjects,
  getBucketInfo,
  presignGetUrl,
  presignPutUrl,
};

export type { R2Object, BucketInfo, R2OperationOptions, StorageScope };
