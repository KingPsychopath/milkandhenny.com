import Redis from "ioredis";
import { Context, Effect, Layer, Schedule } from "effect";

import { getDirectRedisConfig } from "@/lib/platform/redis-direct.server";
import { log } from "@/lib/platform/logger.server";
import { getRuntimeInstanceId } from "@/lib/platform/runtime-metadata.server";

import { isMultiplayerServerMessage } from "./multiplayer-realtime";
import { MULTIPLAYER_ROOM_ID_PATTERN } from "./multiplayer";
import { MultiplayerTelemetry } from "./multiplayer-telemetry.server";

const BUS_CHANNEL = "things:multiplayer:v1:realtime";
const MAX_CHANNEL_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 300;

interface BackplaneEnvelope {
  channel: string;
  message: string;
  origin: string;
}

type BackplaneListener = (channel: string, message: string) => void;

function validChannel(value: string) {
  const match = /^things:(remote:v3|spelling-party:v2|draw-country:v1):room:([^:]+):events$/.exec(
    value,
  );
  return Boolean(match?.[2] && MULTIPLAYER_ROOM_ID_PATTERN.test(match[2]));
}

function validWakeMessage(value: string) {
  try {
    const message: unknown = JSON.parse(value);
    return isMultiplayerServerMessage(message) && message.type === "wake";
  } catch {
    return false;
  }
}

function envelope(value: string): BackplaneEnvelope | null {
  try {
    const parsed = JSON.parse(value) as Partial<BackplaneEnvelope>;
    if (
      typeof parsed.channel !== "string" ||
      parsed.channel.length > MAX_CHANNEL_LENGTH ||
      !validChannel(parsed.channel) ||
      typeof parsed.message !== "string" ||
      parsed.message.length > MAX_MESSAGE_LENGTH ||
      !validWakeMessage(parsed.message) ||
      typeof parsed.origin !== "string" ||
      parsed.origin.length === 0 ||
      parsed.origin.length > 120
    )
      return null;
    return parsed as BackplaneEnvelope;
  } catch {
    return null;
  }
}

export class MultiplayerRealtimeBackplane extends Context.Service<
  MultiplayerRealtimeBackplane,
  {
    readonly mode: "local" | "redis";
    readonly publish: (channel: string, message: string) => Effect.Effect<void>;
    readonly subscribe: (listener: BackplaneListener) => Effect.Effect<() => void>;
  }
>()("MultiplayerRealtimeBackplane") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const telemetry = yield* MultiplayerTelemetry;
      const config = getDirectRedisConfig();
      if (!config) {
        yield* telemetry.setBackplaneMode("local");
        return {
          mode: "local" as const,
          publish: () => Effect.void,
          subscribe: () => Effect.succeed(() => undefined),
        };
      }

      const origin = getRuntimeInstanceId();
      const listeners = new Set<BackplaneListener>();
      const { publisher, subscriber: _subscriber } = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const options = {
            connectTimeout: 3_000,
            enableReadyCheck: true,
            maxRetriesPerRequest: 2,
          };
          const publisher = new Redis(config.url, options);
          const subscriber = new Redis(config.url, options);
          subscriber.on("message", (_channel, raw) => {
            const event = envelope(raw);
            if (!event || event.origin === origin) {
              if (!event) Effect.runSync(telemetry.recordBackplane("receive", "failure"));
              return;
            }
            Effect.runSync(telemetry.recordBackplane("receive", "success"));
            for (const listener of listeners) {
              try {
                listener(event.channel, event.message);
              } catch (error) {
                Effect.runSync(telemetry.recordBackplane("receive", "failure"));
                log.warn("things.multiplayer", "Realtime wake listener failed", {
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          });
          subscriber.on("error", (error) => {
            Effect.runSync(telemetry.recordBackplane("receive", "failure"));
            log.warn("things.multiplayer", "Realtime subscriber error", {
              error: error.message,
            });
          });
          publisher.on("error", (error) => {
            log.warn("things.multiplayer", "Realtime publisher error", {
              error: error.message,
            });
          });
          void subscriber.subscribe(BUS_CHANNEL).catch((error: unknown) => {
            Effect.runSync(telemetry.recordBackplane("receive", "failure"));
            log.error(
              "things.multiplayer",
              "Realtime backplane subscription failed",
              undefined,
              error,
            );
          });
          return { publisher, subscriber };
        }),
        ({ publisher, subscriber }) =>
          Effect.promise(async () => {
            listeners.clear();
            await Promise.allSettled([publisher.quit(), subscriber.quit()]);
            publisher.disconnect();
            subscriber.disconnect();
          }),
      );
      yield* telemetry.setBackplaneMode("redis");
      log.info("things.multiplayer", "Realtime Redis backplane enabled", {
        source: config.source,
      });

      const retryPolicy = Schedule.max([Schedule.exponential("25 millis"), Schedule.recurs(2)]);
      return {
        mode: "redis" as const,
        publish: (channel: string, message: string) =>
          Effect.tryPromise({
            try: () =>
              publisher.publish(
                BUS_CHANNEL,
                JSON.stringify({ channel, message, origin } satisfies BackplaneEnvelope),
              ),
            catch: (cause) => cause,
          }).pipe(
            Effect.timeout(1_000),
            Effect.retry(retryPolicy),
            Effect.tap(() => telemetry.recordBackplane("publish", "success")),
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* telemetry.recordBackplane("publish", "failure");
                log.warn("things.multiplayer", "Realtime wake publication failed", {
                  error: error instanceof Error ? error.message : String(error),
                });
              }),
            ),
            Effect.asVoid,
          ),
        subscribe: (listener) =>
          Effect.sync(() => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          }),
      };
    }),
  );
}
