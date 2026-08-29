/**
 * How RAW and video derivatives get made.
 *
 * - `local`  — inline, in the process handling the upload. No Redis queue, no
 *              worker service. The right choice for development.
 * - `hybrid` — heavy routes are queued for the media worker; images and GIFs
 *              still finish inline because queueing them would only add
 *              latency.
 */
const MEDIA_PROCESSOR_MODES = ["local", "hybrid"] as const;
type MediaProcessorMode = (typeof MEDIA_PROCESSOR_MODES)[number];

function getMediaProcessorMode(): MediaProcessorMode {
  const raw = (process.env.MEDIA_PROCESSOR_MODE ?? "local").toLowerCase();

  if (raw === "local" || raw === "hybrid") return raw;

  throw new Error(`Unsupported MEDIA_PROCESSOR_MODE "${raw}". Configure local or hybrid.`);
}

export { getMediaProcessorMode, MEDIA_PROCESSOR_MODES };

export type { MediaProcessorMode };
