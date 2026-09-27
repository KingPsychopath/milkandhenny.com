import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool, query } from "@/lib/platform/postgres-provider-context.server";
import { getTransfer } from "./store.server";
import type { TransferFile } from "./types";

const CHANNEL = "transfer_media_events_v1";
type Event = { transferId: string; file: TransferFile; at: string };
type Listener = (event: Event) => void;
const listeners = new Map<string, Set<Listener>>();
let subscriber: PoolClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closing = false;

function hasListeners() {
  return [...listeners.values()].some((entries) => entries.size > 0);
}

function scheduleReconnect() {
  if (closing || !hasListeners() || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureSubscribed().catch((error: unknown) => {
      log.warn("transfer.media.events", "Postgres event reconnect failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleReconnect();
    });
  }, 2_000);
  reconnectTimer.unref?.();
}

function releaseSubscriber(client: PoolClient) {
  if (subscriber !== client) return;
  subscriber = null;
  client.release(true);
  scheduleReconnect();
}

async function dispatch(message: Notification) {
  if (message.channel !== CHANNEL || !message.payload) return;
  let payload: unknown;
  try {
    payload = JSON.parse(message.payload);
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const { transferId, fileId, at } = payload as Record<string, unknown>;
  if (typeof transferId !== "string" || typeof fileId !== "string" || typeof at !== "string")
    return;
  if (!listeners.has(transferId)) return;
  try {
    const transfer = await getTransfer(transferId);
    const file = transfer?.files.find(({ id }) => id === fileId);
    if (!file) return;
    for (const listener of listeners.get(transferId) ?? []) {
      try {
        listener({ transferId, file, at });
      } catch (error) {
        log.warn("transfer.media.events", "Postgres event listener threw", {
          transferId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    log.warn("transfer.media.events", "Postgres event snapshot failed", {
      transferId,
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureSubscribed() {
  if (subscriber) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const pool = getPool();
    if (!pool) throw new Error("Postgres is unavailable for transfer events");
    const client = await pool.connect();
    client.on("notification", (message) => {
      void dispatch(message);
    });
    client.once("error", (error: Error) => {
      log.warn("transfer.media.events", "Postgres subscriber failed", {
        error: error.message,
      });
      releaseSubscriber(client);
    });
    client.once("end", () => releaseSubscriber(client));
    try {
      await client.query(`listen ${CHANNEL}`);
      subscriber = client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  })();
  try {
    await connecting;
  } finally {
    connecting = null;
  }
}

export async function publishPostgresTransferMediaEvent(transferId: string, fileId: string) {
  await query("select pg_notify($1,$2)", [
    CHANNEL,
    JSON.stringify({ transferId, fileId, at: new Date().toISOString() }),
  ]);
}

export async function subscribeToPostgresTransferMediaEvents(
  transferId: string,
  listener: Listener,
): Promise<() => void> {
  closing = false;
  const current = listeners.get(transferId) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(transferId, current);
  try {
    await ensureSubscribed();
  } catch (error) {
    current.delete(listener);
    if (current.size === 0) listeners.delete(transferId);
    throw error;
  }
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(transferId);
  };
}

export async function closePostgresTransferMediaEventSubscriber() {
  closing = true;
  listeners.clear();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const client = subscriber;
  subscriber = null;
  if (!client) return;
  try {
    await client.query(`unlisten ${CHANNEL}`);
  } catch {
    // Connection failure already prevents further notifications.
  } finally {
    client.release(true);
  }
}
