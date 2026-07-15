import { deleteObject, downloadBuffer, headObject, uploadBuffer } from "@/lib/platform/r2.server";
import { processToWebP } from "@/features/media/processing.server";
import { mediaPathForTarget } from "@/features/words/upload";
import type { WordMediaJob } from "./media-queue.server";

async function processWordMediaJob(job: WordMediaJob): Promise<"succeeded" | "skipped"> {
  const finalKey = mediaPathForTarget(job.target, job.finalFilename);

  try {
    const raw = await downloadBuffer(job.uploadKey);
    const { buffer: webpBuffer } = await processToWebP(raw, job.original);
    await uploadBuffer(finalKey, webpBuffer, "image/webp");

    try {
      await deleteObject(job.uploadKey);
    } catch {
      // Best-effort cleanup after successful processing.
    }

    return "succeeded";
  } catch (error) {
    const existing = await headObject(finalKey).catch(() => null);
    if (existing) {
      try {
        await deleteObject(job.uploadKey);
      } catch {
        // Ignore cleanup failure when the final object already exists.
      }
      return "skipped";
    }
    throw error;
  }
}

export { processWordMediaJob };
