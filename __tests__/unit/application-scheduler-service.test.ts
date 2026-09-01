import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => ({ registered: [] as string[] }));

vi.mock("@/lib/platform/scheduled-jobs.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform/scheduled-jobs.server")>();
  return {
    ...actual,
    runLeasedScheduledJobEffect: vi.fn((input: { jobKey: string }) => {
      scheduler.registered.push(input.jobKey);
      return Effect.succeed({ ran: false as const });
    }),
  };
});

vi.mock("@/lib/platform/logger.server", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/features/system/media-role.server", () => ({
  isMediaWorkerRole: () => false,
}));

vi.mock("@/features/event-scoring/event-scoring-service.server", async () => {
  const { Context } = await import("effect");
  class EventScoringService extends Context.Service<
    EventScoringService,
    { readonly runScheduled: Effect.Effect<unknown> }
  >()("TestEventScoringService") {}
  return { EventScoringService };
});

import { CommunicationsService } from "@/features/communications/communications-service.server";
import { EventScoringService } from "@/features/event-scoring/event-scoring-service.server";
import { ApplicationSchedulerService } from "@/features/system/application-scheduler-service.server";
import { PostgresService, RedisService } from "@/lib/platform/provider-services.server";

describe("application scheduler service", () => {
  it("registers every owned job, including game-pool cleanup", async () => {
    scheduler.registered.length = 0;
    const dependencies = Layer.mergeAll(
      Layer.succeed(CommunicationsService, {
        runScheduled: Effect.succeed({ staged: 0, waitlistAlerts: 0, handled: 0 }),
      } as never),
      Layer.succeed(EventScoringService, {
        runScheduled: Effect.succeed({
          outbox: { selected: 0, delivered: 0 },
          result: { selected: 0, processed: 0, held: 0, ignored: 0 },
          scoringTransitions: 0,
        }),
      } as never),
      Layer.succeed(PostgresService, { port: {} as never }),
      Layer.succeed(RedisService, { client: Effect.succeed(null) }),
    );
    const layer = ApplicationSchedulerService.layer.pipe(Layer.provide(dependencies));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* ApplicationSchedulerService;
          yield* service.start;
          yield* service.stop;
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(scheduler.registered).toEqual([
      "communications-delivery",
      "event-scoring",
      "media-worker-health",
      "operations-digests",
      "pitch-reminders",
      "game-pool-cleanup",
    ]);
  });
});
