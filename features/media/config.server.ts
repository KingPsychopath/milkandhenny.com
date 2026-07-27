/**
 * How RAW and video derivatives get made.
 *
 * - `local`  — inline, in the process handling the upload. No Redis queue, no
 *              worker service. The right choice for development.
 * - `hybrid` — heavy routes are queued for the media worker; images and GIFs
 *              still finish inline because queueing them would only add
 *              latency.
 *
 * `worker` is accepted as a deprecated alias for `hybrid`. It once meant
 * "queue without trying locally first", but the local-first attempt was
 * removed — the worker runs the same image as the web role, so a decode the
 * web role cannot do the worker cannot do either.
 */
const MEDIA_PROCESSOR_MODES = ["local", "hybrid"] as const;
type MediaProcessorMode = (typeof MEDIA_PROCESSOR_MODES)[number];

function getMediaProcessorMode(): MediaProcessorMode {
  const raw = (
    process.env.MEDIA_PROCESSOR_MODE ??
    process.env.MEDIA_PROCESSOR ??
    "local"
  ).toLowerCase();

  if (raw === "local" || raw === "hybrid") return raw;
  if (raw === "worker") return "hybrid";

  throw new Error(`Unsupported MEDIA_PROCESSOR_MODE "${raw}". Configure local or hybrid.`);
}

export { getMediaProcessorMode, MEDIA_PROCESSOR_MODES };

export type { MediaProcessorMode };
