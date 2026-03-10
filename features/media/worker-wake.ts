import "server-only";

function getTransferMediaWorkerWakeUrl(): string | null {
  const wakeUrl = process.env.TRANSFER_MEDIA_WORKER_WAKE_URL?.trim();
  return wakeUrl ? wakeUrl : null;
}

async function wakeTransferMediaWorker(): Promise<boolean> {
  if (process.env.NODE_ENV === "test") return true;

  const wakeUrl = getTransferMediaWorkerWakeUrl();
  if (!wakeUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const wakeToken = process.env.TRANSFER_MEDIA_WORKER_WAKE_TOKEN;

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

export { getTransferMediaWorkerWakeUrl, wakeTransferMediaWorker };
