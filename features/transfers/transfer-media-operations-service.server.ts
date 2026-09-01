import { Context, Data, Effect, Layer } from "effect";

import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService, RedisService } from "@/lib/platform/provider-services.server";
import { didTransferFileChange } from "./media-state";
import {
  forceReprocessTransferFiles,
  getTransferMediaQueueLength,
} from "./media-backends/worker.server";
import { retryDeadTransferMediaJobs } from "./media-queue.server";
import { reconcileTransferMedia } from "./media-reconcile.server";
import { getTransfer } from "./store.server";
import { backfillTransferMedia } from "./upload.server";
import type { TransferFile } from "./types";

export class TransferMediaOperationError extends Data.TaggedError("TransferMediaOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) => new TransferMediaOperationError({ cause, operation }),
  }).pipe(
    Effect.timeout(5 * 60_000),
    Effect.mapError((cause) =>
      cause instanceof TransferMediaOperationError
        ? cause
        : new TransferMediaOperationError({ cause, operation }),
    ),
    Effect.withSpan(`transfers.media.${operation}`),
  );
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export type TransferMediaBackfillResult =
  | { status: "missing" }
  | { status: "expired" }
  | { status: "completed"; changed: boolean; fileCount: number };

export type TransferMediaRetryResult =
  | { status: "missing" }
  | { status: "expired" }
  | { status: "file-missing" }
  | { status: "refreshed-file-missing" }
  | {
      status: "completed";
      requeued: boolean;
      mediaId: string;
      filename: string;
      processingStatus: TransferFile["processingStatus"];
      retryCount: number;
    };

export type TransferMediaReprocessResult =
  | { status: "missing" }
  | { status: "expired" }
  | {
      status: "completed";
      requeued: Awaited<ReturnType<typeof forceReprocessTransferFiles>>["requeued"];
      skipped: Awaited<ReturnType<typeof forceReprocessTransferFiles>>["skipped"];
    };

/** Admin and CLI controls share the same cancellable media-runtime boundary as the worker. */
export class TransferMediaOperationsService extends Context.Service<
  TransferMediaOperationsService,
  {
    readonly backfill: (
      transferId: string,
    ) => Effect.Effect<TransferMediaBackfillResult, TransferMediaOperationError>;
    readonly clearQueue: Effect.Effect<
      { deletedKeys: number; queueLengthBefore: number; processingLengthBefore: number },
      TransferMediaOperationError
    >;
    readonly queueLength: Effect.Effect<number, TransferMediaOperationError>;
    readonly reconcile: Effect.Effect<
      Awaited<ReturnType<typeof reconcileTransferMedia>>,
      TransferMediaOperationError
    >;
    readonly reprocess: (input: {
      transferId: string;
      kind?: string;
      mediaId?: string;
      filename?: string;
    }) => Effect.Effect<TransferMediaReprocessResult, TransferMediaOperationError>;
    readonly retry: (input: {
      transferId: string;
      mediaId?: string;
      filename?: string;
    }) => Effect.Effect<TransferMediaRetryResult, TransferMediaOperationError>;
    readonly retryDead: (limit?: number) => Effect.Effect<number, TransferMediaOperationError>;
  }
>()("TransferMediaOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const redis = yield* RedisService;
      const storage = yield* ObjectStorageService;
      const usingStorage = <A>(operation: string, run: () => Promise<A>) =>
        attempt(operation, () => withObjectStorageProvider(storage.port, run));
      const readTransfer = (id: string) => attempt("read_transfer", () => getTransfer(id));
      const backfill = (transferId: string) =>
        Effect.gen(function* () {
          const transfer = yield* readTransfer(transferId);
          if (!transfer) return { status: "missing" } as const;
          if (isExpired(transfer.expiresAt)) return { status: "expired" } as const;
          const updated = yield* usingStorage("backfill", () => backfillTransferMedia(transfer));
          return {
            status: "completed",
            changed: updated !== transfer,
            fileCount: updated.files.length,
          } as const;
        }).pipe(Effect.withSpan("transfers.media.backfill_workflow"));
      const retry = (input: { transferId: string; mediaId?: string; filename?: string }) =>
        Effect.gen(function* () {
          const transfer = yield* readTransfer(input.transferId);
          if (!transfer) return { status: "missing" } as const;
          if (isExpired(transfer.expiresAt)) return { status: "expired" } as const;
          const target = transfer.files.find((file) =>
            input.mediaId ? file.id === input.mediaId : file.filename === input.filename,
          );
          if (!target) return { status: "file-missing" } as const;
          const updated = yield* usingStorage("retry", () => backfillTransferMedia(transfer));
          const updatedFile = updated.files.find((file) => file.id === target.id);
          if (!updatedFile) return { status: "refreshed-file-missing" } as const;
          return {
            status: "completed",
            requeued: didTransferFileChange(target, updatedFile),
            mediaId: target.id,
            filename: target.filename,
            processingStatus: updatedFile.processingStatus,
            retryCount: updatedFile.retryCount ?? 0,
          } as const;
        }).pipe(Effect.withSpan("transfers.media.retry_workflow"));
      const reprocess = (input: {
        transferId: string;
        kind?: string;
        mediaId?: string;
        filename?: string;
      }) =>
        Effect.gen(function* () {
          const transfer = yield* readTransfer(input.transferId);
          if (!transfer) return { status: "missing" } as const;
          if (isExpired(transfer.expiresAt)) return { status: "expired" } as const;
          const result = yield* usingStorage("reprocess", () =>
            forceReprocessTransferFiles(transfer, (file) => {
              if (input.mediaId) return file.id === input.mediaId;
              if (input.filename) return file.filename === input.filename;
              return file.kind === input.kind;
            }),
          );
          return { status: "completed", ...result } as const;
        }).pipe(Effect.withSpan("transfers.media.reprocess_workflow"));
      const queueLength = attempt("queue_length", getTransferMediaQueueLength);
      return {
        backfill,
        clearQueue: Effect.gen(function* () {
          const client = yield* redis.client.pipe(
            Effect.mapError(
              (cause) => new TransferMediaOperationError({ cause, operation: "redis_client" }),
            ),
          );
          if (!client) {
            return yield* Effect.fail(
              new TransferMediaOperationError({
                cause: new Error("Redis is not configured"),
                operation: "clear_queue",
              }),
            );
          }
          const [queueLengthBefore, processingLengthBefore] = yield* Effect.all(
            [
              attempt("queued_length", () => client.llen("transfer:media:queue")),
              attempt("processing_length", () => client.llen("transfer:media:processing")),
            ],
            { concurrency: 2 },
          );
          const deletedKeys = yield* attempt("clear_queue", () =>
            client.del("transfer:media:queue", "transfer:media:processing"),
          );
          return { deletedKeys, queueLengthBefore, processingLengthBefore };
        }).pipe(Effect.withSpan("transfers.media.clear_queue")),
        queueLength,
        reconcile: usingStorage("reconcile", reconcileTransferMedia),
        reprocess,
        retry,
        retryDead: (limit = 25) => attempt("retry_dead", () => retryDeadTransferMediaJobs(limit)),
      };
    }),
  );
}
