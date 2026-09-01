import { Context, Data, Effect, Layer } from "effect";

import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { withPostgresProvider } from "@/lib/platform/postgres-provider-context.server";
import { PostgresService, RedisService } from "@/lib/platform/provider-services.server";
import { withRedisProvider } from "@/lib/platform/redis-provider-context.server";
import { controlGamePoolForAdmin, updateGamePoolForAdmin } from "./admin.server";
import { controlGamePoolAsOperatorState, getGamePoolOperatorView } from "./operator.server";
import type { AssignGamePoolRoomInput } from "./pool.server";
import type { GamePoolAssignment } from "./types";
import { listGamePoolEntrances } from "./store.server";
import { gameRealtimeChannel } from "../shared/multiplayer-keys";
import { MultiplayerRealtimeBackplane } from "../shared/multiplayer-realtime-backplane.server";
import { MULTIPLAYER_GAME_REGISTRY } from "../shared/multiplayer-telemetry";

const GAME_POOL_VERSION = Number(MULTIPLAYER_GAME_REGISTRY["game-pool"].channelVersion.slice(1));

export class GamePoolOperationError extends Data.TaggedError("GamePoolOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) => new GamePoolOperationError({ cause, operation }),
  }).pipe(
    Effect.timeout(15_000),
    Effect.mapError((cause) =>
      cause instanceof GamePoolOperationError
        ? cause
        : new GamePoolOperationError({ cause, operation }),
    ),
    Effect.withSpan(`multiplayer.game_pool.${operation}`),
  );
}

function actionFrom(value: unknown): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).action
    : undefined;
}

/** Durable game-pool control followed by advisory realtime publication. */
export class GamePoolOperationsService extends Context.Service<
  GamePoolOperationsService,
  {
    readonly assign: (
      input: AssignGamePoolRoomInput,
    ) => ReturnType<typeof attempt<GamePoolAssignment>>;
    readonly control: (
      id: string,
      value: unknown,
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof controlGamePoolForAdmin>>>>;
    readonly operatorControl: (
      token: string,
      action: "pause" | "resume" | "close" | "close-room",
      roomId?: string,
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof getGamePoolOperatorView>>>>;
    readonly release: (input: {
      token: string;
      clientId: string;
    }) => ReturnType<typeof attempt<{ ok: true }>>;
    readonly update: (
      id: string,
      value: unknown,
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof updateGamePoolForAdmin>>>>;
  }
>()("GamePoolOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const backplane = yield* MultiplayerRealtimeBackplane;
      const postgres = yield* PostgresService;
      const redis = yield* RedisService;
      const redisClient = yield* redis.client;
      const usingProviders = <A>(operation: string, run: () => Promise<A>) =>
        attempt(operation, () =>
          withPostgresProvider(postgres.port, () => withRedisProvider(redisClient, run)),
        );
      const publish = (runId: string, message: object) =>
        backplane.publish(
          gameRealtimeChannel("game-pool", GAME_POOL_VERSION, runId),
          JSON.stringify(message),
        );
      return {
        assign: (input) =>
          Effect.gen(function* () {
            const result = yield* usingProviders("assign", async () => {
              const { assignGamePoolRoomState } = await import("./pool.server");
              return assignGamePoolRoomState(input);
            });
            yield* publish(result.runId, { type: "wake" });
            return result.assignment;
          }).pipe(Effect.withSpan("multiplayer.game_pool.assign_workflow")),
        update: (id, value) =>
          Effect.gen(function* () {
            const entrance = yield* usingProviders("update", () =>
              updateGamePoolForAdmin(id, value),
            );
            if (entrance?.run) yield* publish(entrance.run.id, { type: "wake" });
            return entrance;
          }).pipe(Effect.withSpan("multiplayer.game_pool.update_workflow")),
        control: (id, value) =>
          Effect.gen(function* () {
            const current =
              (yield* usingProviders("read_before_control", () => listGamePoolEntrances())).find(
                (entrance) => entrance.id === id,
              ) ?? null;
            const entrance = yield* usingProviders("control", () =>
              controlGamePoolForAdmin(id, value),
            );
            const runIds = new Set(
              [current?.run?.id, entrance?.run?.id].filter(
                (runId): runId is string => typeof runId === "string",
              ),
            );
            yield* Effect.forEach(runIds, (runId) => publish(runId, { type: "wake" }), {
              concurrency: 2,
              discard: true,
            });
            if (actionFrom(value) === "close" && current?.run?.id) {
              yield* publish(current.run.id, { type: "terminal", reason: "session_ended" });
            }
            return entrance;
          }).pipe(Effect.withSpan("multiplayer.game_pool.control_workflow")),
        operatorControl: (token, action, roomId) =>
          Effect.gen(function* () {
            const runId = yield* usingProviders("operator_control", () =>
              controlGamePoolAsOperatorState(token, action, roomId),
            );
            yield* publish(runId, { type: "wake" });
            if (action === "close") {
              yield* publish(runId, { type: "terminal", reason: "session_ended" });
            }
            return yield* usingProviders("operator_view", () => getGamePoolOperatorView(token));
          }).pipe(Effect.withSpan("multiplayer.game_pool.operator_control_workflow")),
        release: (input) =>
          Effect.gen(function* () {
            const result = yield* usingProviders("release", async () => {
              const { releaseGamePoolAssignmentState } = await import("./pool.server");
              return releaseGamePoolAssignmentState(input);
            });
            if (result.runId) yield* publish(result.runId, { type: "wake" });
            return { ok: true as const };
          }).pipe(Effect.withSpan("multiplayer.game_pool.release_workflow")),
      };
    }),
  );
}
