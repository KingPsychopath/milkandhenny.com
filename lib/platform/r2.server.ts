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
  CopyObjectCommand,
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
  endpoint?: string;
  credentials: Partial<Record<StorageScope, { accessKey: string; secretKey: string }>>;
  publicBucket?: string;
  privateBucket: string;
  maxSockets: number;
  socketAcquisitionWarningTimeoutMs: number;
};

type R2ClientState = {
  client: S3Client;
  configKey: string;
};

type StorageScope = "public" | "private";

type R2OperationOptions = {
  scope: StorageScope;
};

type R2UploadOptions = R2OperationOptions & {
  cacheControl?: string;
  contentDisposition?: string;
};

type R2CopyOptions = {
  sourceScope: StorageScope;
  destinationScope: StorageScope;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
};

/* ─── Client singleton ─── */

const R2_RETRIES = Math.max(0, Math.floor(Number(process.env.R2_RETRIES ?? "4")));
const R2_RETRY_BASE_DELAY_MS = Math.max(
  0,
  Math.floor(Number(process.env.R2_RETRY_BASE_DELAY_MS ?? "400")),
);

const globalForR2 = globalThis as typeof globalThis & {
  __milkHennyR2ClientStates__?: Partial<Record<StorageScope, R2ClientState>>;
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
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const publicAccessKey = process.env.R2_PUBLIC_ACCESS_KEY;
  const publicSecretKey = process.env.R2_PUBLIC_SECRET_KEY;
  const privateAccessKey = process.env.R2_PRIVATE_ACCESS_KEY;
  const privateSecretKey = process.env.R2_PRIVATE_SECRET_KEY;
  const publicBucket = process.env.R2_PUBLIC_BUCKET?.trim();
  const privateBucket = process.env.R2_PRIVATE_BUCKET?.trim();

  if (!accountId || !privateAccessKey || !privateSecretKey || !privateBucket) {
    throw new Error("Missing private R2 env vars. Configure private bucket credentials.");
  }

  const hasAnyPublicConfig = Boolean(publicAccessKey || publicSecretKey || publicBucket);
  const hasCompletePublicConfig = Boolean(publicAccessKey && publicSecretKey && publicBucket);
  if (hasAnyPublicConfig && !hasCompletePublicConfig) {
    throw new Error(
      "Incomplete public R2 env vars. Configure all public bucket credentials or remove them.",
    );
  }

  return {
    accountId,
    endpoint,
    credentials: {
      ...(hasCompletePublicConfig
        ? { public: { accessKey: publicAccessKey!, secretKey: publicSecretKey! } }
        : {}),
      private: { accessKey: privateAccessKey, secretKey: privateSecretKey },
    },
    ...(hasCompletePublicConfig ? { publicBucket } : {}),
    privateBucket,
    maxSockets: parsePositiveInt(process.env.R2_MAX_SOCKETS, getDefaultMaxSockets()),
    socketAcquisitionWarningTimeoutMs: parsePositiveInt(
      process.env.R2_SOCKET_ACQUISITION_WARNING_TIMEOUT_MS,
      10_000,
    ),
  };
}

function getClient(scope: StorageScope): { client: S3Client; config: R2RuntimeConfig } {
  const config = getRuntimeConfig();
  const configKey = JSON.stringify({ ...config, scope });
  const states = globalForR2.__milkHennyR2ClientStates__ ?? {};
  const cached = states[scope];

  if (cached && cached.configKey === configKey) {
    return { client: cached.client, config };
  }

  cached?.client.destroy();
  const credentials = config.credentials[scope];
  if (!credentials) {
    throw new Error(
      `Missing ${scope} R2 credentials. Configure the ${scope} bucket credentials for this role.`,
    );
  }

  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: credentials.accessKey,
      secretAccessKey: credentials.secretKey,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: {
        keepAlive: true,
        maxSockets: config.maxSockets,
      },
      socketAcquisitionWarningTimeout: config.socketAcquisitionWarningTimeoutMs,
    }),
  });
  states[scope] = {
    client,
    configKey,
  };
  globalForR2.__milkHennyR2ClientStates__ = states;

  return { client, config };
}

function getBucket(scope: StorageScope): string {
  const config = getRuntimeConfig();
  const bucket = scope === "public" ? config.publicBucket : config.privateBucket;
  if (!bucket) {
    throw new Error(`Missing ${scope} R2 bucket. Configure the ${scope} bucket for this role.`);
  }
  return bucket;
}

function assertObjectKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..") || key.includes("\\")) {
    throw new Error(`Invalid object key: ${JSON.stringify(key)}`);
  }
}

function assertObjectPrefix(prefix: string): void {
  if (prefix.startsWith("/") || prefix.includes("..") || prefix.includes("\\")) {
    throw new Error(`Invalid object prefix: ${JSON.stringify(prefix)}`);
  }
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
    process.env.R2_PUBLIC_ACCESS_KEY &&
    process.env.R2_PUBLIC_SECRET_KEY &&
    process.env.R2_PRIVATE_ACCESS_KEY &&
    process.env.R2_PRIVATE_SECRET_KEY &&
    process.env.R2_PUBLIC_BUCKET &&
    process.env.R2_PRIVATE_BUCKET
  );
}

function isTransferStorageConfigured(): boolean {
  return isPrivateStorageConfigured();
}

/** Check whether the private transfer bucket is configured for worker-only use. */
function isPrivateStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_PRIVATE_ACCESS_KEY &&
    process.env.R2_PRIVATE_SECRET_KEY &&
    process.env.R2_PRIVATE_BUCKET,
  );
}

/** Lightweight authenticated dependency probe for admin diagnostics. */
async function checkConnection(): Promise<void> {
  const config = getRuntimeConfig();
  if (!config.publicBucket || !config.credentials.public) {
    throw new Error("Public R2 storage is not configured for this role.");
  }
  const scopes = ["public", "private"] as const;
  await Promise.all(
    scopes.map((scope) =>
      sendWithRetry("checkConnection", () =>
        getClient(scope).client.send(
          new HeadBucketCommand({
            Bucket: scope === "public" ? config.publicBucket : config.privateBucket,
          }),
        ),
      ),
    ),
  );
}

/** Lightweight private-bucket probe for the media worker. */
async function checkPrivateStorageConnection(): Promise<void> {
  const config = getRuntimeConfig();
  await sendWithRetry("checkPrivateStorageConnection", () =>
    getClient("private").client.send(new HeadBucketCommand({ Bucket: config.privateBucket })),
  );
}

/* ─── Operations ─── */

/** List objects under a prefix. Pass empty string for root. */
async function listObjects(prefix: string, options: R2OperationOptions): Promise<R2Object[]> {
  assertObjectPrefix(prefix);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);
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
async function listPrefixes(prefix: string, options: R2OperationOptions): Promise<string[]> {
  assertObjectPrefix(prefix);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);
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
  options: R2OperationOptions,
): Promise<{ exists: boolean; size?: number; contentType?: string; cacheControl?: string }> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  try {
    const res = await sendWithRetry("headObject", () =>
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    );
    return {
      exists: true,
      size: res.ContentLength,
      contentType: res.ContentType,
      cacheControl: res.CacheControl,
    };
  } catch (error) {
    if (!isNotFoundR2Error(error)) throw error;
    return { exists: false };
  }
}

/** Download an object as a Buffer. Throws if not found. */
async function downloadBuffer(key: string, options: R2OperationOptions): Promise<Buffer> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

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

/**
 * Stream an object straight to disk.
 *
 * Videos are the reason this exists: `downloadBuffer` would hold a multi-GB
 * original in memory, and ffmpeg wants a seekable file on disk anyway, so
 * buffering first is pure overhead plus an OOM risk.
 */
async function downloadToFile(
  key: string,
  destination: string,
  options: R2OperationOptions,
): Promise<number> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  const res = await sendWithRetry("downloadToFile", () =>
    client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
  );

  if (!res.Body) {
    throw new Error(`Object ${key} has no body`);
  }

  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");

  const body = res.Body as AsyncIterable<Uint8Array>;
  await pipeline(Readable.from(body), createWriteStream(destination));

  return res.ContentLength ?? 0;
}

/** Upload a buffer to the bucket. */
async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string,
  options: R2UploadOptions,
): Promise<void> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  await sendWithRetry("uploadBuffer", () =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: options?.cacheControl,
        ContentDisposition: options?.contentDisposition,
      }),
    ),
  );
}

/** Promote an object within or between explicitly selected storage scopes. */
async function copyObject(
  sourceKey: string,
  destinationKey: string,
  options: R2CopyOptions,
): Promise<void> {
  assertObjectKey(sourceKey);
  assertObjectKey(destinationKey);
  const sourceBucket = getBucket(options.sourceScope);
  const destinationBucket = getBucket(options.destinationScope);

  if (options.sourceScope !== options.destinationScope) {
    await sendWithRetry("copyObjectBetweenScopes", async () => {
      const source = await getClient(options.sourceScope).client.send(
        new GetObjectCommand({ Bucket: sourceBucket, Key: sourceKey }),
      );
      if (!source.Body) throw new Error(`Object ${sourceKey} has no body`);
      await getClient(options.destinationScope).client.send(
        new PutObjectCommand({
          Bucket: destinationBucket,
          Key: destinationKey,
          Body: source.Body,
          ContentLength: source.ContentLength,
          ContentType: options.contentType ?? source.ContentType,
          CacheControl: options.cacheControl ?? source.CacheControl,
          ContentDisposition: options.contentDisposition ?? source.ContentDisposition,
        }),
      );
    });
    return;
  }

  const { client } = getClient(options.destinationScope);
  const replacesMetadata = Boolean(
    options.contentType || options.cacheControl || options.contentDisposition,
  );
  const current =
    replacesMetadata && !options.contentType
      ? await sendWithRetry("headObjectForCopy", () =>
          client.send(new HeadObjectCommand({ Bucket: sourceBucket, Key: sourceKey })),
        )
      : null;

  await sendWithRetry("copyObject", () =>
    client.send(
      new CopyObjectCommand({
        Bucket: destinationBucket,
        Key: destinationKey,
        CopySource: `${sourceBucket}/${sourceKey}`,
        MetadataDirective: replacesMetadata ? "REPLACE" : undefined,
        ContentType: options.contentType ?? current?.ContentType,
        CacheControl: options.cacheControl ?? current?.CacheControl,
        ContentDisposition: options.contentDisposition ?? current?.ContentDisposition,
      }),
    ),
  );
}

/** Replace an object's HTTP metadata without downloading and re-uploading its body. */
async function setObjectHttpMetadata(
  key: string,
  metadata: { cacheControl: string; contentDisposition?: string },
  options: R2OperationOptions,
): Promise<void> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);
  const current = await sendWithRetry("headObjectForMetadata", () =>
    client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
  );

  await sendWithRetry("setObjectHttpMetadata", () =>
    client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${bucket}/${key}`,
        MetadataDirective: "REPLACE",
        CacheControl: metadata.cacheControl,
        ContentType: current.ContentType,
        ContentDisposition: metadata.contentDisposition ?? current.ContentDisposition,
        ContentEncoding: current.ContentEncoding,
        ContentLanguage: current.ContentLanguage,
        Expires: current.Expires,
        Metadata: current.Metadata,
      }),
    ),
  );
}

/** Delete a single object. */
async function deleteObject(key: string, options: R2OperationOptions): Promise<void> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  await sendWithRetry("deleteObject", () =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
  );
}

/** Delete multiple objects at once (max 1000 per call). */
async function deleteObjects(keys: string[], options: R2OperationOptions): Promise<number> {
  if (keys.length === 0) return 0;
  keys.forEach(assertObjectKey);

  let deleted = 0;
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);

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

  return deleted;
}

/** Get bucket usage stats. */
async function getBucketInfo(scope: StorageScope): Promise<BucketInfo> {
  const objects = await listObjects("", { scope });
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
  options: R2UploadOptions,
): Promise<string> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    CacheControl: options?.cacheControl,
    ContentDisposition: options?.contentDisposition,
  });

  return getSignedUrl(client, command, { expiresIn });
}

async function presignGetUrl(
  key: string,
  options: {
    responseCacheControl?: string;
    responseContentDisposition?: string;
    responseContentType?: string;
    expiresIn?: number;
    scope: StorageScope;
  },
): Promise<string> {
  assertObjectKey(key);
  const { scope } = options;
  const { client } = getClient(scope);
  const bucket = getBucket(scope);

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseCacheControl: options?.responseCacheControl,
    ResponseContentDisposition: options?.responseContentDisposition,
    ResponseContentType: options?.responseContentType,
  });

  return getSignedUrl(client, command, { expiresIn: options?.expiresIn ?? 300 });
}

export {
  checkConnection,
  checkPrivateStorageConnection,
  isConfigured,
  isPrivateStorageConfigured,
  isTransferStorageConfigured,
  listObjects,
  listPrefixes,
  headObject,
  downloadBuffer,
  downloadToFile,
  uploadBuffer,
  copyObject,
  setObjectHttpMetadata,
  deleteObject,
  deleteObjects,
  getBucketInfo,
  presignGetUrl,
  presignPutUrl,
};

export type {
  R2Object,
  BucketInfo,
  R2OperationOptions,
  R2UploadOptions,
  R2CopyOptions,
  StorageScope,
};
