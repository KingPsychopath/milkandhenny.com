function getMediaWorkerWakeUrl(): string | null {
  const wakeUrl = (
    process.env.MEDIA_WORKER_WAKE_URL ?? process.env.TRANSFER_MEDIA_WAKE_URL
  )?.trim();
  return wakeUrl ? wakeUrl : null;
}

async function wakeMediaWorker(): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return true;

  const wakeUrl = getMediaWorkerWakeUrl();
  if (!wakeUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const wakeToken = process.env.MEDIA_WORKER_WAKE_TOKEN ?? process.env.TRANSFER_MEDIA_WAKE_TOKEN;

  try {
    const response = await fetch(wakeUrl, {
      method: "POST",
      headers: wakeToken ? { authorization: `Bearer ${wakeToken}` } : undefined,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export { getMediaWorkerWakeUrl, wakeMediaWorker };
