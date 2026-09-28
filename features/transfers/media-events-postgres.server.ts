import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool, query } from "@/lib/platform/postgres-provider-context.server";
import { getTransfer } from "./store.server";
import type { TransferFile } from "./types";

const CHANNEL = "transfer_media_events_v1";
type Event = { transferId: string; file: TransferFile; at: string };
type Listener = (event: Event) => void;
// Nitro and SSR evaluate separate bundles. Keep their subscriber and shutdown owner shared,
// just like the process-wide Postgres pool that supplies this dedicated connection.
type SubscriberState = {
  listeners: Map<string, Set<Listener>>;
  subscriber: PoolClient | null;
  connecting: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closing: boolean;
  closed: boolean;
};
const processState = globalThis as typeof globalThis & {
  __mahTransferMediaSubscriber?: SubscriberState;
};
const state = (processState.__mahTransferMediaSubscriber ??= {
  listeners: new Map<string, Set<Listener>>(),
  subscriber: null,
  connecting: null,
  reconnectTimer: null,
  closing: false,
  closed: false,
});

function hasListeners() {
  return [...state.listeners.values()].some((entries) => entries.size > 0);
}

function scheduleReconnect() {
  if (state.closing || !hasListeners() || state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void ensureSubscribed()
      .then(reconcileListeners)
      .catch((error: unknown) => {
        log.warn("transfer.media.events", "Postgres event reconnect failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleReconnect();
      });
  }, 2_000);
  state.reconnectTimer.unref?.();
}

function releaseSubscriber(client: PoolClient) {
  if (state.subscriber !== client) return;
  state.subscriber = null;
  client.release(true);
  scheduleReconnect();
}

function notify(transferId: string, file: TransferFile, at: string) {
  for (const listener of state.listeners.get(transferId) ?? []) {
    try {
      listener({ transferId, file, at });
    } catch (error) {
      log.warn("transfer.media.events", "Postgres event listener threw", {
        transferId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function reconcileListeners() {
  // Browser streams survive a backplane outage, so they will not rerun the route snapshot.
  // LISTEN must be restored before reading authoritative state to cover the missed interval.
  for (const transferId of state.listeners.keys()) {
    if (state.closing) return;
    const transfer = await getTransfer(transferId);
    const at = new Date().toISOString();
    for (const file of transfer?.files ?? []) notify(transferId, file, at);
  }
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
  if (!state.listeners.has(transferId)) return;
  try {
    const transfer = await getTransfer(transferId);
    const file = transfer?.files.find(({ id }) => id === fileId);
    if (!file) return;
    notify(transferId, file, at);
  } catch (error) {
    log.warn("transfer.media.events", "Postgres event snapshot failed", {
      transferId,
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureSubscribed() {
  if (state.closing) throw new Error("Transfer media subscriber is closed");
  if (state.subscriber) return;
  if (state.connecting) return state.connecting;
  state.connecting = (async () => {
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
      if (state.closing) {
        client.release(true);
        return;
      }
      state.subscriber = client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  })();
  try {
    await state.connecting;
  } finally {
    state.connecting = null;
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
  if (state.closed) throw new Error("Transfer media subscriber is closed");
  state.closing = false;
  const current = state.listeners.get(transferId) ?? new Set<Listener>();
  current.add(listener);
  state.listeners.set(transferId, current);
  try {
    await ensureSubscribed();
  } catch (error) {
    current.delete(listener);
    if (current.size === 0) state.listeners.delete(transferId);
    throw error;
  }
  return () => {
    current.delete(listener);
    if (current.size === 0) state.listeners.delete(transferId);
  };
}

export async function closePostgresTransferMediaEventSubscriber(
  options: { permanent?: boolean } = {},
) {
  state.closed ||= options.permanent === true;
  state.closing = true;
  state.listeners.clear();
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  // A LISTEN still being established must release its checkout before pool shutdown.
  await state.connecting?.catch(() => undefined);
  const client = state.subscriber;
  state.subscriber = null;
  if (!client) return;
  try {
    await client.query(`unlisten ${CHANNEL}`);
  } catch {
    // Connection failure already prevents further notifications.
  } finally {
    client.release(true);
  }
}
