import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool } from "@/lib/platform/postgres.server";
import {
  parseScoreRealtimeEvent,
  SCORE_REALTIME_CHANNEL,
  type ScoreRealtimeEvent,
} from "./score-realtime";

type ScoreEventListener = (event: ScoreRealtimeEvent) => void;
type Subscription = { participantId: string; listener: ScoreEventListener };

const listeners = new Map<string, Set<Subscription>>();
let subscriber: PoolClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let closing = false;

function listenerCount(): number {
  return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
}

function dispatch(event: ScoreRealtimeEvent): void {
  const allowed = event.participantIds ? new Set(event.participantIds) : null;
  for (const subscription of listeners.get(event.eventSlug) ?? []) {
    if (allowed && !allowed.has(subscription.participantId)) continue;
    try {
      subscription.listener(event);
    } catch (error) {
      log.warn("event-scoring.realtime", "Score event listener threw", {
        eventSlug: event.eventSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function handleNotification(message: Notification): void {
  if (message.channel !== SCORE_REALTIME_CHANNEL || !message.payload) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.payload);
  } catch {
    return;
  }
  const event = parseScoreRealtimeEvent(parsed);
  if (event) dispatch(event);
}

function scheduleReconnect(): void {
  if (closing || reconnectTimer || listenerCount() === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureSubscribed().catch((error: unknown) => {
      log.warn("event-scoring.realtime", "Score event subscriber reconnect failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      scheduleReconnect();
    });
  }, 1_000);
  reconnectTimer.unref?.();
}

function releaseSubscriber(client: PoolClient): void {
  if (subscriber !== client) return;
  subscriber = null;
  client.release(true);
  scheduleReconnect();
}

async function ensureSubscribed(): Promise<void> {
  if (subscriber) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const pool = getPool();
    if (!pool) throw new Error("Postgres is unavailable for score events");
    const client = await pool.connect();
    client.on("notification", handleNotification);
    client.once("error", (error: Error) => {
      log.warn("event-scoring.realtime", "Score event subscriber connection failed", {
        error: error.message,
      });
      releaseSubscriber(client);
    });
    client.once("end", () => releaseSubscriber(client));
    try {
      await client.query(`listen ${SCORE_REALTIME_CHANNEL}`);
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

export async function subscribeToScoreEvents(
  eventSlug: string,
  participantId: string,
  listener: ScoreEventListener,
): Promise<() => void> {
  closing = false;
  const subscription = { participantId, listener };
  const eventListeners = listeners.get(eventSlug) ?? new Set<Subscription>();
  eventListeners.add(subscription);
  listeners.set(eventSlug, eventListeners);
  try {
    await ensureSubscribed();
  } catch (error) {
    eventListeners.delete(subscription);
    if (eventListeners.size === 0) listeners.delete(eventSlug);
    throw error;
  }
  return () => {
    const current = listeners.get(eventSlug);
    current?.delete(subscription);
    if (current?.size === 0) listeners.delete(eventSlug);
  };
}

export async function closeScoreEventSubscriber(): Promise<void> {
  closing = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  listeners.clear();
  const client = subscriber;
  subscriber = null;
  if (!client) return;
  try {
    await client.query(`unlisten ${SCORE_REALTIME_CHANNEL}`);
  } catch {
    // The connection may already be gone.
  } finally {
    client.release(true);
  }
}
