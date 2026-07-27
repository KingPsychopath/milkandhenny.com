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

/** Six hours covers a 5 GiB file on a slow connection with room to spare. */
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
 * A single presigned PUT cannot carry more than 5 GiB — that is the S3/R2
 * limit, not ours, and we do not implement multipart. Enforced for everyone,
 * admins included: without this an oversized file uploads for hours and then
 * fails with an opaque `EntityTooLarge` from storage.
 */
const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

export {
  getUploadReservationTtlSeconds,
  getUploadUrlTtlSeconds,
  MAX_SINGLE_PUT_BYTES,
  RESERVATION_GRACE_SECONDS,
};
