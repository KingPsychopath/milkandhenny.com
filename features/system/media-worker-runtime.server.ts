import type Redis from "ioredis";
import { Context, Data, Deferred, Effect, Fiber, Layer, Schedule } from "effect";

import { getMediaProcessorMode } from "@/features/media/config.server";
import { processWorkerJob } from "@/features/transfers/media-backends/worker.server";
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
import { MediaMaintenanceService } from "./media-maintenance-service.server";
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUntilAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
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

async function consumeTransferQueue(input: {
  blockingRedis: Redis;
  claimTimeoutSeconds: number;
  errorBackoffMs: number;
  signal?: AbortSignal;
}): Promise<ConsumeResult> {
  let processedJobs = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  while (!input.signal?.aborted) {
    let claimedTransfer: Awaited<ReturnType<typeof claimTransferMediaJobBlocking>> | null = null;

    try {
      claimedTransfer = await claimTransferMediaJobBlocking(
        input.blockingRedis,
        input.claimTimeoutSeconds,
      );
      if (!claimedTransfer) break;

      const outcome = await processWorkerJob(claimedTransfer.job);
      await ackTransferMediaJob(claimedTransfer.raw);
      processedJobs += 1;
      if (outcome === "succeeded") succeeded += 1;
      else if (outcome === "failed") failed += 1;
      else skipped += 1;
      await markMediaJobProcessed();
    } catch (error) {
      if (input.signal?.aborted && !claimedTransfer) break;

      if (claimedTransfer) {
        const deliveryAttempt = claimedTransfer.job.deliveryAttempt ?? 0;
        const backoffMs = Math.min(120_000, input.errorBackoffMs * 2 ** deliveryAttempt);
        if (input.signal) {
          await sleepUntilAbort(backoffMs, input.signal);
        } else {
          await sleep(backoffMs);
        }
        await requeueTransferMediaJob(claimedTransfer.raw);
      }

      await recordWorkerError(error);
      if (input.signal?.aborted) break;
      if (!claimedTransfer) {
        if (input.signal) await sleepUntilAbort(input.errorBackoffMs, input.signal);
        else await sleep(input.errorBackoffMs);
      }
    }
  }

  return { processedJobs, succeeded, failed, skipped };
}

async function drainMediaQueuesUntilIdle(
  options: DrainMediaQueuesOptions = {},
): Promise<DrainMediaQueuesResult> {
  if (getMediaProcessorMode() === "local") {
    return {
      disabled: true,
      recoveredTransferJobs: 0,
      processedJobs: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const claimTimeoutSeconds = Math.max(
    1,
    options.transferClaimTimeoutSeconds ?? DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS,
  );
  const concurrency = positiveInteger(
    options.concurrency ?? DEFAULT_WORKER_CONCURRENCY,
    DEFAULT_WORKER_CONCURRENCY,
  );
  const errorBackoffMs = positiveInteger(
    options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
    DEFAULT_ERROR_BACKOFF_MS,
  );
  const recoveredTransferJobs =
    options.recoverStuckJobs === false ? 0 : await recoverTransferMediaProcessingJobs();
  const blockingClients = createBlockingClients(concurrency);

  await heartbeat();
  try {
    const loopResults = await Promise.all(
      blockingClients.map((blockingRedis) =>
        consumeTransferQueue({
          blockingRedis,
          claimTimeoutSeconds,
          errorBackoffMs,
        }),
      ),
    );
    return {
      disabled: false,
      recoveredTransferJobs,
      processedJobs: loopResults.reduce((sum, result) => sum + result.processedJobs, 0),
      succeeded: loopResults.reduce((sum, result) => sum + result.succeeded, 0),
      failed: loopResults.reduce((sum, result) => sum + result.failed, 0),
      skipped: loopResults.reduce((sum, result) => sum + result.skipped, 0),
    };
  } finally {
    await closeBlockingClients(blockingClients);
  }
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

function claimJob(client: Redis) {
  return workerAttempt("claim", async (signal) => {
    const disconnect = () => disconnectBlockingClient(client);
    signal.addEventListener("abort", disconnect, { once: true });
    try {
      // The direct Redis client has a 15-second command deadline. A finite
      // Redis-side block returns normally before that deadline and keeps an
      // idle worker from reporting a false infrastructure failure.
      return await claimTransferMediaJobBlocking(client, DEFAULT_TRANSFER_CLAIM_TIMEOUT_SECONDS);
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
  return workerAttempt("process", () =>
    withObjectStorageProvider(storage, () => processWorkerJob(claimed.job)),
  ).pipe(
    Effect.timeout(5 * 60_000),
    Effect.flatMap((outcome) =>
      workerAttempt("ack", () => ackTransferMediaJob(claimed.raw)).pipe(
        Effect.andThen(workerAttempt("status", () => markMediaJobProcessed())),
        Effect.as(outcome),
      ),
    ),
    Effect.tap((outcome) =>
      Effect.sync(() =>
        log.info("media.worker", "Transfer media job completed", {
          outcome,
          deliveryAttempt: claimed.job.deliveryAttempt ?? 0,
        }),
      ),
    ),
    Effect.catch((error) => {
      const deliveryAttempt = claimed.job.deliveryAttempt ?? 0;
      const backoffMs = Math.min(120_000, errorBackoffMs * 2 ** deliveryAttempt);
      return Effect.sleep(backoffMs).pipe(
        Effect.andThen(workerAttempt("requeue", () => requeueTransferMediaJob(claimed.raw))),
        Effect.andThen(workerAttempt("record_error", () => recordWorkerError(error))),
        Effect.asVoid,
      );
    }),
  );
}

function workerSlot(client: Redis, errorBackoffMs: number, storage: ObjectStorageProvider) {
  return Effect.forever(
    claimJob(client).pipe(
      Effect.flatMap((claimed) =>
        claimed ? consumeClaim(claimed, errorBackoffMs, storage) : Effect.void,
      ),
      Effect.catch((error) =>
        workerAttempt("record_claim_error", () => recordWorkerError(error)).pipe(
          Effect.andThen(Effect.sleep(errorBackoffMs)),
        ),
      ),
    ),
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
    MediaWorkerService.layer(options).pipe(Layer.provide(transferInfrastructureLayer)),
    MediaMaintenanceService.layer.pipe(Layer.provide(transferInfrastructureLayer)),
    TransferOperationsService.layer.pipe(Layer.provide(transferInfrastructureLayer)),
  );
}

export type MediaServices =
  | MediaMaintenanceService
  | MediaWorkerService
  | TransferOperationsService;

let mediaWorkerRuntime = makeManagedRuntimeHost(makeMediaLayer(), "Media and transfers");

export function runMediaEffect<A, E>(
  effect: Effect.Effect<A, E, MediaServices>,
  signal?: AbortSignal,
) {
  return mediaWorkerRuntime.run(effect, signal);
}

function startMediaWorkerLoop(options: DrainMediaQueuesOptions = {}): void {
  if (getMediaProcessorMode() === "local") return;
  if (options.concurrency !== undefined || options.errorBackoffMs !== undefined) {
    mediaWorkerRuntime = makeManagedRuntimeHost(makeMediaLayer(options), "Media and transfers");
  }
  void mediaWorkerRuntime
    .run(
      Effect.gen(function* () {
        yield* (yield* MediaWorkerService).start;
      }),
    )
    .catch((error) => log.error("media.worker", "Could not start media worker", {}, error));
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

export {
  disposeMediaWorkerRuntime,
  drainMediaQueuesUntilIdle,
  startMediaWorkerLoop,
  stopMediaWorkerLoop,
};
export type { DrainMediaQueuesOptions, DrainMediaQueuesResult };
