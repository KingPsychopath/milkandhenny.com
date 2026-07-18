type MediaProcessorMode = "local" | "hybrid" | "worker";

function getMediaProcessorMode(): MediaProcessorMode {
  const raw = (
    process.env.MEDIA_PROCESSOR_MODE ??
    process.env.MEDIA_PROCESSOR ??
    "local"
  ).toLowerCase();
  if (raw === "local" || raw === "hybrid" || raw === "worker") return raw;
  throw new Error(`Unsupported MEDIA_PROCESSOR_MODE "${raw}". Configure local, hybrid, or worker.`);
}

export { getMediaProcessorMode };

export type { MediaProcessorMode };
