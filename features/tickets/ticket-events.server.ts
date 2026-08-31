import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool, query } from "@/lib/platform/postgres.server";
import {
  parseTicketRealtimeEvent,
  TICKET_REALTIME_CHANNEL,
  type TicketRealtimeEvent,
} from "./ticket-realtime";

type Listener = (event: TicketRealtimeEvent) => void;
const listeners = new Map<string, Set<Listener>>();
let subscriber: PoolClient | null = null;
let connecting: Promise<void> | null = null;

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
      if (subscriber === client) subscriber = null;
      client.release(true);
    });
    await client.query(`listen ${TICKET_REALTIME_CHANNEL}`);
    subscriber = client;
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
