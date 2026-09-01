import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  assign: vi.fn(),
  control: vi.fn(),
  controlOperator: vi.fn(),
  getOperatorView: vi.fn(),
  list: vi.fn(),
  release: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/features/things/pool/admin.server", () => ({
  controlGamePoolForAdmin: state.control,
  updateGamePoolForAdmin: state.update,
}));

vi.mock("@/features/things/pool/store.server", () => ({
  listGamePoolEntrances: state.list,
}));

vi.mock("@/features/things/pool/operator.server", () => ({
  controlGamePoolAsOperatorState: state.controlOperator,
  getGamePoolOperatorView: state.getOperatorView,
}));

vi.mock("@/features/things/pool/pool.server", () => ({
  assignGamePoolRoomState: state.assign,
  releaseGamePoolAssignmentState: state.release,
}));

import { GamePoolOperationsService } from "@/features/things/pool/game-pool-operations-service.server";
import { MultiplayerRealtimeBackplane } from "@/features/things/shared/multiplayer-realtime-backplane.server";
import { PostgresService, RedisService } from "@/lib/platform/provider-services.server";

describe("game-pool Effect operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits control state before publishing wake and terminal hints", async () => {
    const published: Array<{ channel: string; message: string }> = [];
    state.list.mockResolvedValue([{ id: "entrance", run: { id: "old-run" } }]);
    state.control.mockResolvedValue({ id: "entrance", run: { id: "new-run" } });
    const backplane = Layer.succeed(MultiplayerRealtimeBackplane, {
      mode: "local",
      publish: (channel: string, message: string) =>
        Effect.sync(() => published.push({ channel, message })),
      subscribe: () => Effect.succeed(() => undefined),
    });
    const layer = GamePoolOperationsService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          backplane,
          Layer.succeed(PostgresService, { port: {} as never }),
          Layer.succeed(RedisService, { client: Effect.succeed(null) }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      GamePoolOperationsService.use((service) =>
        service.control("entrance", { action: "close" }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ id: "entrance", run: { id: "new-run" } });
    expect(state.control).toHaveBeenCalledAfter(state.list);
    expect(published).toEqual([
      {
        channel: "things:game-pool:v1:room:old-run:events",
        message: JSON.stringify({ type: "wake" }),
      },
      {
        channel: "things:game-pool:v1:room:new-run:events",
        message: JSON.stringify({ type: "wake" }),
      },
      {
        channel: "things:game-pool:v1:room:old-run:events",
        message: JSON.stringify({ type: "terminal", reason: "session_ended" }),
      },
    ]);
  });

  it("coordinates organizer control and returns the refreshed durable view", async () => {
    const published: string[] = [];
    state.controlOperator.mockResolvedValue("run-1");
    state.getOperatorView.mockResolvedValue({ found: true, runId: "run-1", status: "closed" });
    const backplane = Layer.succeed(MultiplayerRealtimeBackplane, {
      mode: "local",
      publish: (_channel: string, message: string) => Effect.sync(() => published.push(message)),
      subscribe: () => Effect.succeed(() => undefined),
    });
    const layer = GamePoolOperationsService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          backplane,
          Layer.succeed(PostgresService, { port: {} as never }),
          Layer.succeed(RedisService, { client: Effect.succeed(null) }),
        ),
      ),
    );

    const result = await Effect.runPromise(
      GamePoolOperationsService.use((service) => service.operatorControl("token", "close")).pipe(
        Effect.provide(layer),
      ),
    );

    expect(state.getOperatorView).toHaveBeenCalledAfter(state.controlOperator);
    expect(published).toEqual([
      JSON.stringify({ type: "wake" }),
      JSON.stringify({ type: "terminal", reason: "session_ended" }),
    ]);
    expect(result).toMatchObject({ found: true, runId: "run-1", status: "closed" });
  });

  it("coordinates public assignment and release before publishing wake hints", async () => {
    const published: string[] = [];
    state.assign.mockResolvedValue({ assignment: { roomId: "ROOM123" }, runId: "run-1" });
    state.release.mockResolvedValue({ ok: true, runId: "run-1" });
    const backplane = Layer.succeed(MultiplayerRealtimeBackplane, {
      mode: "local",
      publish: (_channel: string, message: string) => Effect.sync(() => published.push(message)),
      subscribe: () => Effect.succeed(() => undefined),
    });
    const layer = GamePoolOperationsService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          backplane,
          Layer.succeed(PostgresService, { port: {} as never }),
          Layer.succeed(RedisService, { client: Effect.succeed(null) }),
        ),
      ),
    );

    const assignment = await Effect.runPromise(
      GamePoolOperationsService.use((service) =>
        service.assign({
          token: "play-token",
          clientId: "client-123456",
          name: "Ada",
          choice: "auto",
          moveExisting: false,
        }),
      ).pipe(Effect.provide(layer)),
    );
    const released = await Effect.runPromise(
      GamePoolOperationsService.use((service) =>
        service.release({ token: "play-token", clientId: "client-123456" }),
      ).pipe(Effect.provide(layer)),
    );

    expect(assignment).toEqual({ roomId: "ROOM123" });
    expect(released).toEqual({ ok: true });
    expect(published).toEqual([JSON.stringify({ type: "wake" }), JSON.stringify({ type: "wake" })]);
  });
});
