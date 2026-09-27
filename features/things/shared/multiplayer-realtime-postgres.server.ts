import type { Notification, PoolClient } from "pg";

import { log } from "@/lib/platform/logger.server";
import { getPool, query } from "@/lib/platform/postgres-provider-context.server";

const CHANNEL = "multiplayer_realtime_v1";

/** One dedicated LISTEN connection per multiplayer runtime, never one per socket. */
export class PostgresMultiplayerRealtimeTransport {
  private subscriber: PoolClient | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;

  constructor(private readonly receive: (payload: string) => void) {}

  private scheduleReconnect() {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start().catch((error: unknown) => {
        log.warn("things.multiplayer", "Postgres realtime reconnect failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect();
      });
    }, 2_000);
    this.reconnectTimer.unref?.();
  }

  private disconnect(client: PoolClient) {
    if (this.subscriber !== client) return;
    this.subscriber = null;
    client.release(true);
    this.scheduleReconnect();
  }

  async start(): Promise<void> {
    if (this.closing) throw new Error("Postgres realtime transport is closed");
    if (this.subscriber) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const pool = getPool();
      if (!pool) throw new Error("Postgres is unavailable for multiplayer realtime");
      const client = await pool.connect();
      client.on("notification", (notification: Notification) => {
        if (notification.channel === CHANNEL && notification.payload)
          this.receive(notification.payload);
      });
      client.once("error", (error: Error) => {
        log.warn("things.multiplayer", "Postgres realtime subscriber failed", {
          error: error.message,
        });
        this.disconnect(client);
      });
      client.once("end", () => this.disconnect(client));
      try {
        await client.query(`listen ${CHANNEL}`);
        if (this.closing) {
          client.release(true);
          return;
        }
        this.subscriber = client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async publish(payload: string): Promise<void> {
    await query("select pg_notify($1,$2)", [CHANNEL, payload]);
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.subscriber;
    this.subscriber = null;
    if (!client) return;
    try {
      await client.query(`unlisten ${CHANNEL}`);
    } catch {
      // The broken connection no longer carries notifications.
    } finally {
      client.release(true);
    }
  }
}
