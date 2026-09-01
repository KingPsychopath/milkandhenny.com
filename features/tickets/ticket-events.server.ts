import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool, query } from "@/lib/platform/postgres-provider-context.server";
import {
  parseTicketRealtimeEvent,
  TICKET_REALTIME_CHANNEL,
  type TicketRealtimeEvent,
} from "./ticket-realtime";

type Listener = (event: TicketRealtimeEvent) => void;
const listeners = new Map<string, Set<Listener>>();
let subscriber: PoolClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectWake: (() => void) | null = null;
let closing = false;

function key(eventSlug: string, ticketId: string) {
  return `${eventSlug}:${ticketId}`;
}

function notification(message: Notification) {
  if (message.channel !== TICKET_REALTIME_CHANNEL || !message.payload) return;
  try {
    const event = parseTicketRealtimeEvent(JSON.parse(message.payload) as unknown);
    if (!event) return;
    for (const listener of listeners.get(key(event.eventSlug, event.ticketId)) ?? [])
      listener(event);
  } catch {
    // Notifications are wake-ups; clients still reconcile from durable state.
  }
}

function listenerCount(): number {
  return [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
}

function scheduleReconnect(): void {
  if (!closing && listenerCount() > 0) reconnectWake?.();
}

function releaseSubscriber(client: PoolClient): void {
  if (subscriber !== client) return;
  subscriber = null;
  client.release(true);
  scheduleReconnect();
}

async function ensureSubscriber() {
  if (subscriber) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const pool = getPool();
    if (!pool) throw new Error("Postgres is unavailable for ticket events");
    const client = await pool.connect();
    client.on("notification", notification);
    client.once("error", (error: Error) => {
      log.warn("tickets.realtime", "Ticket event subscriber connection failed", {
        error: error.message,
      });
      releaseSubscriber(client);
    });
    client.once("end", () => releaseSubscriber(client));
    try {
      await client.query(`listen ${TICKET_REALTIME_CHANNEL}`);
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

export async function publishTicketEvent(event: TicketRealtimeEvent): Promise<void> {
  await query("select pg_notify($1,$2)", [TICKET_REALTIME_CHANNEL, JSON.stringify(event)]);
}

export async function subscribeToTicketEvents(
  eventSlug: string,
  ticketId: string,
  listener: Listener,
): Promise<() => void> {
  closing = false;
  const subscriptionKey = key(eventSlug, ticketId);
  const current = listeners.get(subscriptionKey) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(subscriptionKey, current);
  try {
    await ensureSubscriber();
  } catch (error) {
    current.delete(listener);
    if (current.size === 0) listeners.delete(subscriptionKey);
    throw error;
  }
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(subscriptionKey);
  };
}

export async function closeTicketEventSubscriber(): Promise<void> {
  closing = true;
  listeners.clear();
  const client = subscriber;
  subscriber = null;
  if (!client) return;
  try {
    await client.query(`unlisten ${TICKET_REALTIME_CHANNEL}`);
  } catch {
    // The connection may already be gone.
  } finally {
    client.release(true);
  }
}

/** Effect runtime hook: reconnect timing and retry ownership stay outside this adapter. */
export function setTicketEventReconnectWake(wake: (() => void) | null): void {
  reconnectWake = wake;
}

export async function reconnectTicketEventSubscriber(): Promise<void> {
  if (closing || listenerCount() === 0) return;
  try {
    await ensureSubscriber();
  } catch (error) {
    log.warn("tickets.realtime", "Ticket event subscriber reconnect failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
