import type Redis from "ioredis";
import { Cause, Context, Data, Deferred, Effect, Fiber, Layer, Ref, Schedule } from "effect";

import { AlbumOperationsService } from "@/features/media/album-operations-service.server";
import { getMediaProcessorMode } from "@/features/media/config.server";
import { getWorkerProcessingTimeoutMs } from "@/features/transfers/media-processing-config.server";
import {
  markWorkerJobTimedOut,
  processWorkerJob,
} from "@/features/transfers/media-backends/worker.server";
import {
  ackTransferMediaJob,
  claimTransferMediaJobBlocking,
  recoverTransferMediaProcessingJobs,
  requeueTransferMediaJob,
} from "@/features/transfers/media-queue.server";
import { reconcileTransferMedia } from "@/features/transfers/media-reconcile.server";
import { updateTransferMediaWorkerStatus } from "@/features/transfers/media-worker-status.server";
import { summarizeMediaWorkerError } from "@/features/transfers/media-worker-health";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { TransferMediaOperationsService } from "@/features/transfers/transfer-media-operations-service.server";
import { MediaMaintenanceService } from "./media-maintenance-service.server";
import { WordMediaService } from "@/features/words/word-media-service.server";
import { WordOperationsService } from "@/features/words/word-operations-service.server";
import { ObjectStorageService, RedisService } from "@/lib/platform/provider-services.server";
import { createDirectRedisClient } from "@/lib/platform/redis-direct.server";
import { log } from "@/lib/platform/logger.server";
import { makeManagedRuntimeHost } from "@/lib/platform/managed-runtime.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import {
  withObjectStorageProvider,
  type ObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";

interface DrainMediaQueuesResult {
  disabled: boolean;
  recoveredTransferJobs: number;
  processedJobs: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

interface DrainMediaQueuesOptions {
  concurrency?: number;
  transferClaimTimeoutSeconds?: number;
  errorBackoffMs?: number;
  /**
   * Requeue jobs whose processing lease has expired after a crashed run.
   */
  recoverStuckJobs?: boolean;
}

type ConsumeResult = Pick<
  DrainMediaQueuesResult,
  "processedJobs" | "succeeded" | "failed" | "skipped"
>;

const DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS = 10;

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

const DEFAULT_WORKER_CONCURRENCY = positiveInteger(
  Number(process.env.MEDIA_WORKER_CONCURRENCY ?? "1"),
  1,
);
const DEFAULT_ERROR_BACKOFF_MS = positiveInteger(
  Number(process.env.MEDIA_WORKER_ERROR_BACKOFF_MS ?? "15000"),
  15_000,
);

function getReconcileIntervalMs(): number {
  const raw = Number(process.env.MEDIA_RECONCILE_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 15 * 60_000;
}

function getHeartbeatIntervalMs(): number {
  const raw = Number(process.env.MEDIA_WORKER_HEARTBEAT_INTERVAL_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.max(30_000, raw) : 5 * 60_000;
}

function getErrorDetail(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message).slice(0, 500)
    : String(error).slice(0, 500);
}

async function heartbeat(): Promise<void> {
  await updateTransferMediaWorkerStatus({ lastHeartbeatAt: new Date().toISOString() });
}

async function markMediaJobProcessed(): Promise<void> {
  const timestamp = new Date().toISOString();
  await updateTransferMediaWorkerStatus({
    lastHeartbeatAt: timestamp,
    lastProcessedAt: timestamp,
  });
}

async function recordWorkerError(error: unknown): Promise<void> {
  const timestamp = new Date().toISOString();
  const errorDetail = getErrorDetail(error);
  const errorSummary = summarizeMediaWorkerError(errorDetail);
  console.error(`[media-worker] error\n${errorDetail}`);
  try {
    await updateTransferMediaWorkerStatus({
      lastHeartbeatAt: timestamp,
      lastErrorAt: timestamp,
      lastErrorMessage: errorSummary,
    });
  } catch (statusError) {
    console.error(`[media-worker] could not persist error status\n${getErrorDetail(statusError)}`);
  }
}

function createBlockingClients(concurrency: number): Redis[] {
  return Array.from({ length: concurrency }, () => createDirectRedisClient());
}

const disconnectedBlockingClients = new WeakSet<Redis>();

function disconnectBlockingClient(client: Redis): void {
  if (disconnectedBlockingClients.has(client)) return;
  disconnectedBlockingClients.add(client);
  client.disconnect();
}

async function closeBlockingClients(clients: Redis[]): Promise<void> {
  await Promise.all(
    clients.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }),
  );
}

export class MediaWorkerError extends Data.TaggedError("MediaWorkerError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function workerAttempt<A>(operation: string, run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, () => run(signal)),
    catch: (cause) => new MediaWorkerError({ cause, operation }),
  }).pipe(Effect.withSpan(`media.worker.${operation}`, { attributes: { operation } }));
}

function claimJob(client: Redis, timeoutSeconds = DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS) {
  return workerAttempt("claim", async (signal) => {
    const disconnect = () => disconnectBlockingClient(client);
    signal.addEventListener("abort", disconnect, { once: true });
    try {
      // The direct Redis client has a 15-second command deadline. A finite
      // Redis-side block returns normally before that deadline and keeps an
      // idle worker from reporting a false infrastructure failure.
      return await claimTransferMediaJobBlocking(client, timeoutSeconds);
    } finally {
      signal.removeEventListener("abort", disconnect);
    }
  });
}

function consumeClaim(
  claimed: NonNullable<Awaited<ReturnType<typeof claimTransferMediaJobBlocking>>>,
  errorBackoffMs: number,
  storage: ObjectStorageProvider,
) {
  const processing = workerAttempt("process", (signal) =>
    withObjectStorageProvider(storage, () => processWorkerJob(claimed.job, signal)),
  );
  const timeoutMs = getWorkerProcessingTimeoutMs();
  const settle = (outcome: "succeeded" | "failed" | "skipped") =>
    workerAttempt("ack", () => ackTransferMediaJob(claimed.raw)).pipe(
      Effect.andThen(workerAttempt("status", () => markMediaJobProcessed())),
      Effect.as(outcome),
    );
  const requeue = (error: unknown) => {
    const deliveryAttempt = claimed.job.deliveryAttempt ?? 0;
    const backoffMs = Math.min(120_000, errorBackoffMs * 2 ** deliveryAttempt);
    return Effect.sleep(backoffMs).pipe(
      Effect.andThen(workerAttempt("requeue", () => requeueTransferMediaJob(claimed.raw))),
      Effect.andThen(workerAttempt("record_error", () => recordWorkerError(error))),
      Effect.as(null),
    );
  };
  return (timeoutMs > 0 ? processing.pipe(Effect.timeout(timeoutMs)) : processing).pipe(
    Effect.flatMap(settle),
    Effect.tap((outcome) =>
      Effect.sync(() =>
        log.info("media.worker", "Transfer media job completed", {
          outcome,
          deliveryAttempt: claimed.job.deliveryAttempt ?? 0,
        }),
      ),
    ),
    Effect.catch((error) => {
      if (!Cause.isTimeoutError(error)) return requeue(error);
      return workerAttempt("record_timeout", () =>
        withObjectStorageProvider(storage, () => markWorkerJobTimedOut(claimed.job, timeoutMs)),
      ).pipe(
        Effect.flatMap((outcome) =>
          settle(outcome).pipe(
            Effect.andThen(workerAttempt("record_timeout_error", () => recordWorkerError(error))),
            Effect.as(outcome),
          ),
        ),
        Effect.catch(() => requeue(error)),
      );
    }),
  );
}

function workerSlot(client: Redis, errorBackoffMs: number, storage: ObjectStorageProvider) {
  return Effect.forever(
    claimJob(client).pipe(
      Effect.flatMap((claimed) =>
        claimed ? consumeClaim(claimed, errorBackoffMs, storage).pipe(Effect.asVoid) : Effect.void,
      ),
      Effect.catch((error) =>
        workerAttempt("record_claim_error", () => recordWorkerError(error)).pipe(
          Effect.andThen(Effect.sleep(errorBackoffMs)),
        ),
      ),
    ),
  );
}

function drainWorkerSlot(
  client: Redis,
  claimTimeoutSeconds: number,
  errorBackoffMs: number,
  storage: ObjectStorageProvider,
  remaining?: Ref.Ref<number>,
) {
  return Effect.gen(function* () {
    const summary: ConsumeResult = { processedJobs: 0, succeeded: 0, failed: 0, skipped: 0 };
    while (true) {
      if (remaining) {
        const allowed = yield* Ref.modify(remaining, (count) =>
          count > 0 ? [true, count - 1] : [false, 0],
        );
        if (!allowed) return summary;
      }
      const claimed = yield* claimJob(client, claimTimeoutSeconds);
      if (!claimed) return summary;
      const outcome = yield* consumeClaim(claimed, errorBackoffMs, storage);
      if (!outcome) continue;
      summary.processedJobs += 1;
      summary[outcome] += 1;
    }
  });
}

function drainMediaQueues(
  options: DrainMediaQueuesOptions,
  storage: ObjectStorageProvider,
  maxJobs?: number,
): Effect.Effect<DrainMediaQueuesResult, MediaWorkerError, never> {
  if (getMediaProcessorMode() === "local") {
    return Effect.succeed({
      disabled: true,
      recoveredTransferJobs: 0,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
  }

  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONCURRENCY,
  );
  const claimTimeoutSeconds = Math.max(
    1,
    options.transferClaimTimeoutSeconds ?? DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS,
  );
  const errorBackoffMs = positiveInteger(
    options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
    DEFAULT_ERROR_BACKOFF_MS,
  );
  return Effect.scoped(
    Effect.gen(function* () {
      const remaining =
        maxJobs === undefined ? undefined : yield* Ref.make(Math.max(0, Math.floor(maxJobs)));
      const clients = yield* Effect.acquireRelease(
        Effect.sync(() => createBlockingClients(concurrency)),
        (active) =>
          workerAttempt("close_clients", () => closeBlockingClients(active)).pipe(Effect.orDie),
      );
      const recoveredTransferJobs =
        options.recoverStuckJobs === false
          ? 0
          : yield* workerAttempt("recover", () => recoverTransferMediaProcessingJobs());
      yield* workerAttempt("heartbeat", () => heartbeat());
      const results = yield* Effect.forEach(
        clients,
        (client) =>
          drainWorkerSlot(client, claimTimeoutSeconds, errorBackoffMs, storage, remaining),
        { concurrency },
      );
      return {
        disabled: false,
        recoveredTransferJobs,
        processedJobs: results.reduce((sum, result) => sum + result.processedJobs, 0),
        succeeded: results.reduce((sum, result) => sum + result.succeeded, 0),
        failed: results.reduce((sum, result) => sum + result.failed, 0),
        skipped: results.reduce((sum, result) => sum + result.skipped, 0),
      };
    }),
  );
}

function maintenance(recoverStuckJobs: boolean, storage: ObjectStorageProvider) {
  const heartbeatLoop = Effect.repeat(
    workerAttempt("heartbeat", () => heartbeat()).pipe(
      Effect.catch((error) =>
        workerAttempt("record_heartbeat_error", () => recordWorkerError(error)),
      ),
    ),
    Schedule.spaced(getHeartbeatIntervalMs()),
  );
  const reconcileIntervalMs = getReconcileIntervalMs();
  const reconcileLoop =
    reconcileIntervalMs <= 0
      ? Effect.never
      : Effect.gen(function* () {
          const recovered = recoverStuckJobs
            ? yield* workerAttempt("recover", () => recoverTransferMediaProcessingJobs())
            : 0;
          const swept = yield* workerAttempt("reconcile", () =>
            withObjectStorageProvider(storage, reconcileTransferMedia),
          );
          if (recovered > 0 || swept.transfersRepaired > 0) {
            yield* Effect.sync(() =>
              log.info("media.worker", "Media queue recovery completed", {
                recoveredJobs: recovered,
                repairedFiles: swept.filesRepaired,
                repairedTransfers: swept.transfersRepaired,
              }),
            );
          }
        }).pipe(
          Effect.catch((error) =>
            workerAttempt("record_reconcile_error", () => recordWorkerError(error)),
          ),
          Effect.repeat(Schedule.spaced(reconcileIntervalMs)),
        );
  return Effect.all([heartbeatLoop, reconcileLoop], { concurrency: 2, discard: true });
}

export class MediaWorkerService extends Context.Service<
  MediaWorkerService,
  {
    readonly drain: (limit?: number) => Effect.Effect<DrainMediaQueuesResult, MediaWorkerError>;
    readonly reconcile: Effect.Effect<Awaited<ReturnType<typeof reconcileTransferMedia>>, unknown>;
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
  }
>()("MediaWorkerService") {
  static layer(options: DrainMediaQueuesOptions = {}) {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        const storage = yield* ObjectStorageService;
        const concurrency = positiveInteger(
          options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
          DEFAULT_WORKER_CONCURRENCY,
        );
        const errorBackoffMs = positiveInteger(
          options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
          DEFAULT_ERROR_BACKOFF_MS,
        );
        const startGate = yield* Deferred.make<void>();
        const stopGate = yield* Deferred.make<void>();
        const active = Deferred.await(startGate).pipe(
          Effect.andThen(
            Effect.scoped(
              Effect.gen(function* () {
                const clients = yield* Effect.acquireRelease(
                  Effect.sync(() => createBlockingClients(concurrency)),
                  (active) => Effect.sync(() => active.forEach(disconnectBlockingClient)),
                );
                return yield* Effect.all(
                  [
                    ...clients.map((client) => workerSlot(client, errorBackoffMs, storage.port)),
                    maintenance(options.recoverStuckJobs !== false, storage.port),
                  ],
                  { concurrency: "unbounded", discard: true },
                );
              }),
            ),
          ),
        );
        const fiber = yield* Effect.race(Deferred.await(stopGate), active).pipe(Effect.forkScoped);
        return {
          drain: (limit) => drainMediaQueues(options, storage.port, limit),
          reconcile: workerAttempt("reconcile", () =>
            withObjectStorageProvider(storage.port, reconcileTransferMedia),
          ),
          start:
            getMediaProcessorMode() === "local"
              ? Effect.void
              : Deferred.succeed(startGate, undefined).pipe(Effect.asVoid),
          stop: Deferred.succeed(stopGate, undefined).pipe(
            Effect.andThen(Fiber.await(fiber)),
            Effect.asVoid,
          ),
        };
      }),
    );
  }
}

const transferInfrastructureLayer = Layer.mergeAll(ObjectStorageService.layer, RedisService.layer);

function makeMediaLayer(options: DrainMediaQueuesOptions = {}) {
  return Layer.mergeAll(
    AlbumOperationsService.layer.pipe(Layer.provide(ObjectStorageService.layer)),
    MediaWorkerService.layer(options).pipe(Layer.provide(transferInfrastructureLayer)),
    MediaMaintenanceService.layer.pipe(Layer.provide(transferInfrastructureLayer)),
    TransferOperationsService.layer.pipe(Layer.provide(transferInfrastructureLayer)),
    TransferMediaOperationsService.layer.pipe(Layer.provide(transferInfrastructureLayer)),
    WordMediaService.layer.pipe(Layer.provide(ObjectStorageService.layer)),
    WordOperationsService.layer.pipe(Layer.provide(ObjectStorageService.layer)),
  );
}

export type MediaServices =
  | AlbumOperationsService
  | MediaMaintenanceService
  | MediaWorkerService
  | TransferOperationsService
  | TransferMediaOperationsService
  | WordMediaService
  | WordOperationsService;

let mediaWorkerRuntime = makeManagedRuntimeHost(makeMediaLayer(), "Media and transfers");

export function runMediaEffect<A, E>(
  effect: Effect.Effect<A, E, MediaServices>,
  signal?: AbortSignal,
) {
  return mediaWorkerRuntime.run(effect, signal);
}

async function startMediaWorkerLoop(options: DrainMediaQueuesOptions = {}): Promise<void> {
  if (getMediaProcessorMode() === "local") return;
  if (options.concurrency !== undefined || options.errorBackoffMs !== undefined) {
    // Custom startup settings are used by isolated worker hosts and tests. Release the existing
    // scoped runtime before replacing it so there is still exactly one Media runtime and no idle
    // provider resources are left behind.
    await mediaWorkerRuntime.dispose();
    mediaWorkerRuntime = makeManagedRuntimeHost(makeMediaLayer(options), "Media and transfers");
  }
  await mediaWorkerRuntime.run(
    Effect.gen(function* () {
      yield* (yield* MediaWorkerService).start;
    }),
  );
}

async function stopMediaWorkerLoop(): Promise<void> {
  await mediaWorkerRuntime.run(
    Effect.gen(function* () {
      yield* (yield* MediaWorkerService).stop;
    }),
  );
}

function disposeMediaWorkerRuntime(): Promise<void> {
  return mediaWorkerRuntime.dispose();
}

function drainMediaQueuesUntilIdle(): Promise<DrainMediaQueuesResult> {
  return runMediaEffect(
    Effect.gen(function* () {
      return yield* (yield* MediaWorkerService).drain();
    }),
  );
}

export {
  disposeMediaWorkerRuntime,
  drainMediaQueuesUntilIdle,
  startMediaWorkerLoop,
  stopMediaWorkerLoop,
};
export type { DrainMediaQueuesOptions, DrainMediaQueuesResult };
