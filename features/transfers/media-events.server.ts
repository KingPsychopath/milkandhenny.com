/**
 * Live processing updates, pushed rather than polled.
 *
 * The worker and the web server are different processes, so a completed job
 * has to cross a process boundary to reach the browser. Redis pub/sub carries
 * it: the worker publishes once per file, every web replica receives it, and
 * each replica fans it out to whichever viewers are watching that transfer.
 *
 * The alternative — clients polling the transfer endpoint — is what caused
 * docs/postmortem-guestlist-kv-read-spike.md, and it scales with viewers
 * rather than with actual work.
 */

import {
  createDirectRedisClient,
  getCommandRedis,
  getDirectRedisConfig,
} from "@/lib/platform/redis-direct.server";
import { log } from "@/lib/platform/logger.server";
import type { TransferFile } from "./types";

const TRANSFER_MEDIA_EVENT_CHANNEL = "transfer:media:events";

type TransferMediaEvent = {
  transferId: string;
  file: TransferFile;
  at: string;
};

type TransferMediaEventListener = (event: TransferMediaEvent) => void;

function isTransferMediaEvent(value: unknown): value is TransferMediaEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TransferMediaEvent>;
  return (
    typeof candidate.transferId === "string" &&
    typeof candidate.at === "string" &&
    Boolean(candidate.file) &&
    typeof candidate.file === "object" &&
    typeof (candidate.file as TransferFile).id === "string"
  );
}

/**
 * Announce that a file finished processing.
 *
 * Best-effort by design: a dropped notification costs a viewer a refresh, and
 * must never fail the job that produced it.
 */
async function publishTransferMediaEvent(transferId: string, file: TransferFile): Promise<void> {
  if (!getDirectRedisConfig()) return;

  const event: TransferMediaEvent = {
    transferId,
    file,
    at: new Date().toISOString(),
  };

  try {
    await getCommandRedis().publish(TRANSFER_MEDIA_EVENT_CHANNEL, JSON.stringify(event));
  } catch (error) {
    log.warn("transfer.media.events", "Failed to publish processing event", {
      transferId,
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/* ─── Subscriber (web role) ─── */

const listeners = new Map<string, Set<TransferMediaEventListener>>();
let subscriber: ReturnType<typeof createDirectRedisClient> | null = null;
let subscribing: Promise<void> | null = null;

/** One Redis subscription per process, shared by every open stream. */
async function ensureSubscribed(): Promise<void> {
  if (subscriber) return;
  if (subscribing) return subscribing;

  subscribing = (async () => {
    const client = createDirectRedisClient();
    client.on("message", (channel: string, raw: string) => {
      if (channel !== TRANSFER_MEDIA_EVENT_CHANNEL) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isTransferMediaEvent(parsed)) return;

      for (const listener of listeners.get(parsed.transferId) ?? []) {
        try {
          listener(parsed);
        } catch (error) {
          log.warn("transfer.media.events", "Listener threw", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
    client.on("error", (error: Error) => {
      log.warn("transfer.media.events", "Subscriber connection error", { error: error.message });
    });

    await client.subscribe(TRANSFER_MEDIA_EVENT_CHANNEL);
    subscriber = client;
  })();

  try {
    await subscribing;
  } finally {
    subscribing = null;
  }
}

/** Watch one transfer. Returns an unsubscribe function. */
async function subscribeToTransferMediaEvents(
  transferId: string,
  listener: TransferMediaEventListener,
): Promise<() => void> {
  await ensureSubscribed();

  const existing = listeners.get(transferId) ?? new Set<TransferMediaEventListener>();
  existing.add(listener);
  listeners.set(transferId, existing);

  return () => {
    const current = listeners.get(transferId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(transferId);
  };
}

async function closeTransferMediaEventSubscriber(): Promise<void> {
  const client = subscriber;
  subscriber = null;
  listeners.clear();
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export {
  closeTransferMediaEventSubscriber,
  publishTransferMediaEvent,
  subscribeToTransferMediaEvents,
  TRANSFER_MEDIA_EVENT_CHANNEL,
};
export type { TransferMediaEvent };
