/**
 * How long an upload is allowed to take.
 *
 * Every presigned PUT URL for a batch is minted at once, before the first byte
 * moves. So the window is not "how long one request takes" — it is how long the
 * *whole selection* takes to reach object storage. Someone emptying a phone
 * after a wedding sends several gigabytes over hotel wifi; at the old 15 minutes
 * the later URLs in the batch were already dead when their turn came, and the
 * reservation had expired too, so a finalize that arrived after an hour of
 * successful uploading was rejected outright and every byte was wasted.
 *
 * The reservation always outlives the URLs: an upload that finishes inside the
 * window must still find something to finalise against.
 */

function readSecondsEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Six hours covers large resumable uploads without leaving credentials open indefinitely. */
const DEFAULT_UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60;

/** Margin for the client to finish its last PUT and call finalize. */
const RESERVATION_GRACE_SECONDS = 30 * 60;

function getUploadUrlTtlSeconds(): number {
  return readSecondsEnv("TRANSFER_UPLOAD_URL_TTL_SECONDS", DEFAULT_UPLOAD_URL_TTL_SECONDS);
}

function getUploadReservationTtlSeconds(): number {
  return getUploadUrlTtlSeconds() + RESERVATION_GRACE_SECONDS;
}

/**
 * Small objects use one PUT. Larger objects are split into independently
 * retryable parts before reaching the provider's single-PUT ceiling.
 */
const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;
const MULTIPART_UPLOAD_THRESHOLD_BYTES = 1024 * 1024 * 1024;
const MULTIPART_MIN_PART_BYTES = 128 * 1024 * 1024;
const MULTIPART_TARGET_MAX_PARTS = 1_000;
const MAX_MULTIPART_FILE_BYTES = 500 * 1024 * 1024 * 1024;

function getMultipartPartSize(size: number): number {
  const fiveMiB = 5 * 1024 * 1024;
  const needed = Math.ceil(size / MULTIPART_TARGET_MAX_PARTS / fiveMiB) * fiveMiB;
  return Math.max(MULTIPART_MIN_PART_BYTES, needed);
}

export {
  getUploadReservationTtlSeconds,
  getUploadUrlTtlSeconds,
  MAX_SINGLE_PUT_BYTES,
  MAX_MULTIPART_FILE_BYTES,
  MULTIPART_UPLOAD_THRESHOLD_BYTES,
  getMultipartPartSize,
  RESERVATION_GRACE_SECONDS,
};
