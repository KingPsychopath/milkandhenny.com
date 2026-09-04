import { Context, Data, Effect, Layer } from "effect";

import {
  ObjectStorageService,
  RedisService,
  type InfrastructureError,
} from "@/lib/platform/provider-services.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { isSafeTransferId } from "./admin.server";
import { getTransferFileDeleteKeys } from "./delete";
import { getMimeType } from "@/features/media/processing.server";
import { buildTransferProcessingCounts, type TransferProcessingCounts } from "./media-state";
import { buildTransferArchivedOriginalStorageKey, buildTransferPrimaryStorageKey } from "./storage";
import {
  appendTransferFiles,
  createTransfer,
  deleteTransferData,
  getTransfer,
  normaliseTransferTitle,
  removeTransferFileAtomic,
  updateTransferGrouping,
  validateDeleteToken,
} from "./store.server";
import type { TransferData } from "./types";
import type { TransferUploadFileInput } from "./upload-types";
import {
  createTransferUploadReservation,
  deleteTransferUploadReservation,
  getTransferUploadReservation,
  getTransferUploadReservationKey,
  transferUploadFilesFingerprint,
} from "./upload-reservation.server";
import { applyTransferAssetGroups, processUploadedFile, sortTransferFiles } from "./upload.server";
import { getInlineProcessingTimeoutMs } from "./media-processing-config.server";
import { getMultipartPartSize, MULTIPART_UPLOAD_THRESHOLD_BYTES } from "./upload-window.server";

export class TransferOperationError extends Data.TaggedError("TransferOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
  timeoutMs: false | number = 45_000,
) {
  const attempted = Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, () => run(signal)),
    catch: (cause) => new TransferOperationError({ cause, operation }),
  });
  return (timeoutMs === false ? attempted : attempted.pipe(Effect.timeout(timeoutMs))).pipe(
    Effect.mapError((cause) =>
      cause instanceof TransferOperationError
        ? cause
        : new TransferOperationError({ cause, operation }),
    ),
    Effect.withSpan(`transfers.${operation}`, { attributes: { operation } }),
  );
}

function redisCommand<A>(operation: string, run: () => Promise<A>) {
  return attempt(`redis.${operation}`, run);
}

export type TransferCleanupResult = {
  mode: "deep" | "index";
  expiredIndexEntries: number;
  scannedPrefixes: number;
  deletedObjects: number;
};

type TransferFileCounts = {
  images: number;
  videos: number;
  gifs: number;
  audio: number;
  other: number;
};

function countTransferFiles(files: TransferData["files"]): TransferFileCounts {
  const counts: TransferFileCounts = { images: 0, videos: 0, gifs: 0, audio: 0, other: 0 };
  for (const file of files) {
    if (file.kind === "image") counts.images += 1;
    else if (file.kind === "video") counts.videos += 1;
    else if (file.kind === "gif") counts.gifs += 1;
    else if (file.kind === "audio") counts.audio += 1;
    else counts.other += 1;
  }
  return counts;
}

export type TransferPresignResult =
  | {
      status: "ready";
      urls: Array<{
        name: string;
        mediaId?: string;
        contentType: string;
        primaryUrl?: string;
        multipart?: {
          uploadId: string;
          partSize: number;
          parts: Array<{ partNumber: number; url: string }>;
        };
        archivedOriginalUrl?: string;
      }>;
    }
  | { status: "reservation-conflict" };

export type TransferFinalizeResult =
  | {
      status: "completed";
      transfer: TransferData;
      totalSize: number;
      fileCounts: TransferFileCounts;
      processingCounts: TransferProcessingCounts;
      deduplicated: boolean;
    }
  | { status: "missing-reservation" }
  | { status: "reservation-mismatch" }
  | { status: "size-mismatch"; filename: string; archivedOriginal: boolean }
  | { status: "too-large"; actualUploadedBytes: number }
  | { status: "transfer-conflict" };

export type TransferResumeResult =
  | {
      status: "ready";
      urls: Extract<TransferPresignResult, { status: "ready" }>["urls"];
      uploadedNames: string[];
    }
  | { status: "missing-reservation" }
  | { status: "reservation-mismatch" };

export type TransferAbandonResult =
  | { status: "abandoned"; deletedObjects: number }
  | { status: "missing-reservation" }
  | { status: "reservation-mismatch" };

export type TransferAppendResult =
  | {
      status: "completed";
      transfer: TransferData;
      addedCount: number;
      totalSize: number;
      fileCounts: TransferFileCounts;
      processingCounts: TransferProcessingCounts;
    }
  | { status: "missing" | "conflict" | "limit" }
  | { status: "size-mismatch"; filename: string; archivedOriginal: boolean };

export type TransferFileRemovalResult =
  | { status: "unauthorised" }
  | { status: "missing" }
  | { status: "file-missing" }
  | { status: "deleted"; deletedObjects: number }
  | { status: "updated"; deletedObjects: number; transfer: TransferData };

/** Private-transfer side effects; validation and transfer policy remain ordinary TypeScript. */
export class TransferOperationsService extends Context.Service<
  TransferOperationsService,
  {
    readonly adminDelete: (
      id: string,
    ) => Effect.Effect<{ deletedFiles: number; dataDeleted: boolean }, unknown>;
    readonly cleanup: (mode: "deep" | "index") => Effect.Effect<TransferCleanupResult, unknown>;
    readonly abandonUpload: (input: {
      transferId: string;
      deleteToken: string;
      actorJti: string;
    }) => Effect.Effect<TransferAbandonResult, unknown>;
    readonly finalizeAppend: (input: {
      transferId: string;
      files: TransferUploadFileInput[];
      maxFiles?: number;
      maxTotalBytes?: number;
    }) => Effect.Effect<TransferAppendResult, unknown>;
    readonly finalizeUpload: (input: {
      transferId: string;
      deleteToken: string;
      actorJti: string;
      title?: string;
      expiresSeconds: number;
      files: TransferUploadFileInput[];
      maxTotalBytes?: number;
    }) => Effect.Effect<TransferFinalizeResult, unknown>;
    readonly presignUpload: (input: {
      transferId: string;
      deleteToken: string;
      actorJti: string;
      expiresSeconds: number;
      files: TransferUploadFileInput[];
      uploadUrlTtlSeconds: number;
    }) => Effect.Effect<TransferPresignResult, unknown>;
    readonly presignAppend: (input: {
      transferId: string;
      files: TransferUploadFileInput[];
      uploadUrlTtlSeconds: number;
    }) => Effect.Effect<Extract<TransferPresignResult, { status: "ready" }>, unknown>;
    readonly resumeUpload: (input: {
      transferId: string;
      deleteToken: string;
      actorJti: string;
      files: TransferUploadFileInput[];
      uploadUrlTtlSeconds: number;
    }) => Effect.Effect<TransferResumeResult, unknown>;
    readonly removeFile: (input: {
      id: string;
      fileId: string;
      token: string;
    }) => Effect.Effect<TransferFileRemovalResult, unknown>;
    readonly nuke: Effect.Effect<
      | { configured: false }
      | {
          configured: true;
          deletedFiles: number;
          deletedTransfers: number;
          timestamp: string;
        },
      unknown
    >;
    readonly takedown: (input: {
      id: string;
      token: string;
    }) => Effect.Effect<
      { authorised: boolean; deletedFiles: number; dataDeleted: boolean },
      unknown
    >;
  }
>()("TransferOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const redis = yield* RedisService;

      const removeObjects = (id: string) =>
        Effect.gen(function* () {
          if (!storage.port.isTransferStorageConfigured()) return 0;
          const prefix = `transfers/${id}/`;
          const objects = yield* storage.listObjects(prefix, { scope: "private" });
          const keys = objects.map(({ key }) => key).filter((key) => key.startsWith(prefix));
          return keys.length > 0 ? yield* storage.deleteObjects(keys, { scope: "private" }) : 0;
        });

      const takedown = (input: { id: string; token: string }) =>
        Effect.gen(function* () {
          const authorised = yield* attempt("authorise_takedown", () =>
            validateDeleteToken(input.id, input.token),
          );
          if (!authorised) return { authorised: false, deletedFiles: 0, dataDeleted: false };
          const deletedFiles = yield* removeObjects(input.id);
          const dataDeleted = yield* attempt("delete_metadata", () => deleteTransferData(input.id));
          return { authorised: true, deletedFiles, dataDeleted };
        }).pipe(Effect.withSpan("transfers.takedown"));

      const cleanup = (mode: "deep" | "index") =>
        Effect.gen(function* () {
          const client = yield* redis.client;
          if (!client) {
            return yield* Effect.fail(
              new TransferOperationError({
                cause: new Error("Redis is not configured"),
                operation: "cleanup",
              }),
            );
          }
          const indexedIds = yield* redisCommand("list_index", () =>
            client.smembers("transfer:index"),
          );
          const expiredIds = yield* Effect.forEach(
            indexedIds,
            (id) =>
              redisCommand("check_transfer", () => client.exists(`transfer:${id}`)).pipe(
                Effect.map((exists) => (exists === 0 ? id : null)),
              ),
            { concurrency: 8 },
          ).pipe(Effect.map((ids) => ids.filter((id): id is string => id !== null)));
          if (expiredIds.length > 0) {
            yield* redisCommand("prune_index", async () => {
              const pipeline = client.pipeline();
              expiredIds.forEach((id) => pipeline.srem("transfer:index", id));
              await pipeline.exec();
            });
          }
          if (mode === "index") {
            return {
              mode,
              expiredIndexEntries: expiredIds.length,
              scannedPrefixes: 0,
              deletedObjects: 0,
            };
          }

          const prefixes = yield* storage.listPrefixes("transfers/", { scope: "private" });
          const ids = prefixes
            .map((prefix) => prefix.replace("transfers/", "").replace(/\/$/, ""))
            .filter(Boolean);
          const orphanIds = yield* Effect.forEach(
            ids,
            (id) =>
              Effect.all(
                {
                  transfer: redisCommand("check_orphan_transfer", () =>
                    client.exists(`transfer:${id}`),
                  ),
                  reservation: redisCommand("check_orphan_reservation", () =>
                    client.exists(getTransferUploadReservationKey(id)),
                  ),
                },
                { concurrency: 2 },
              ).pipe(
                Effect.map(({ transfer, reservation }) =>
                  transfer === 0 && reservation === 0 ? id : null,
                ),
              ),
            { concurrency: 8 },
          ).pipe(Effect.map((values) => values.filter((id): id is string => id !== null)));
          const deleted = yield* Effect.forEach(
            orphanIds,
            (id) =>
              removeObjects(id).pipe(
                Effect.tap(() =>
                  redisCommand("prune_orphan", () => client.srem("transfer:index", id)),
                ),
              ),
            { concurrency: 2 },
          );
          return {
            mode,
            expiredIndexEntries: expiredIds.length,
            scannedPrefixes: ids.length,
            deletedObjects: deleted.reduce((sum, count) => sum + count, 0),
          };
        }).pipe(Effect.withSpan("transfers.cleanup", { attributes: { mode } }));

      const completed = (transfer: TransferData, deduplicated: boolean): TransferFinalizeResult => {
        return {
          status: "completed",
          transfer,
          totalSize: transfer.files.reduce((sum, file) => sum + (file.storedBytes ?? file.size), 0),
          fileCounts: countTransferFiles(transfer.files),
          processingCounts: buildTransferProcessingCounts(transfer.files),
          deduplicated,
        };
      };

      const findCompleted = (transferId: string, deleteToken: string) =>
        Effect.gen(function* () {
          const existing = yield* attempt("read_existing", () => getTransfer(transferId));
          if (!existing) return null;
          const authorised = yield* attempt("authorise_existing", () =>
            validateDeleteToken(transferId, deleteToken),
          );
          return authorised ? completed(existing, true) : null;
        });

      const presignFiles = (
        transferId: string,
        files: TransferUploadFileInput[],
        uploadUrlTtlSeconds: number,
      ) =>
        Effect.forEach(
          files,
          (file) => {
            const primaryKey = buildTransferPrimaryStorageKey(transferId, file);
            const archivedOriginalKey = buildTransferArchivedOriginalStorageKey(transferId, file);
            return Effect.all(
              {
                primary,
                archivedOriginalUrl:
                  archivedOriginalKey && file.originalName
            const multipart = file.size > MULTIPART_UPLOAD_THRESHOLD_BYTES;
            const primary = multipart
              ? Effect.gen(function* () {
                  if (!storage.createMultipartUpload || !storage.presignMultipartUploadParts) {
                    return yield* Effect.fail(
                      new TransferOperationError({
                        cause: new Error("Multipart object storage is unavailable"),
                        operation: "presign_multipart",
                      }),
                    );
                  }
                  const uploadId = yield* storage.createMultipartUpload(
                    primaryKey,
                    getMimeType(file.name),
                    { scope: "private" },
                  );
                  const partSize = getMultipartPartSize(file.size);
                  const partCount = Math.ceil(file.size / partSize);
                  const parts = yield* storage
                    .presignMultipartUploadParts(
                      primaryKey,
                      uploadId,
                      partCount,
                      uploadUrlTtlSeconds,
                      { scope: "private" },
                    )
                    .pipe(
                      Effect.tapError(() =>
                        storage.abortMultipartUpload
                          ? storage
                              .abortMultipartUpload(primaryKey, uploadId, { scope: "private" })
                              .pipe(Effect.catch(() => Effect.void))
                          : Effect.void,
                      ),
                    );
                  return { multipart: { uploadId, partSize, parts } };
                })
              : storage
                  .presignPutUrl(primaryKey, getMimeType(file.name), uploadUrlTtlSeconds, {
                    scope: "private",
                  })
                  .pipe(Effect.map((primaryUrl) => ({ primaryUrl })));
                    ? storage.presignPutUrl(
                        archivedOriginalKey,
                        getMimeType(file.originalName),
                        uploadUrlTtlSeconds,
                        { scope: "private" },
                      )
                    : Effect.succeed(undefined),
              },
              { concurrency: 2 },
            ).pipe(
              Effect.map(({ primary, archivedOriginalUrl }) => ({
                name: file.name,
                mediaId: file.mediaId,
                contentType: getMimeType(file.name),
                ...primary,
                archivedOriginalUrl,
              })),
            );
          },
          { concurrency: 4 },
        );

      const inspectUploadedFiles = (transferId: string, files: TransferUploadFileInput[]) =>
        Effect.forEach(
          files,
          (file) =>
            Effect.gen(function* () {
              const primary = yield* storage.headObject(
                buildTransferPrimaryStorageKey(transferId, file),
                { scope: "private" },
              );
              if (!primary.exists || primary.size !== file.size) {
      const completeMultipartFiles = (transferId: string, files: TransferUploadFileInput[]) =>
        Effect.forEach(
          files.filter((file) => file.multipart),
          (file) =>
            Effect.gen(function* () {
              const key = buildTransferPrimaryStorageKey(transferId, file);
              const existing = yield* storage.headObject(key, { scope: "private" });
              if (existing.exists && existing.size === file.size) return;
              if (!storage.completeMultipartUpload || !file.multipart) {
                return yield* Effect.fail(
                  new TransferOperationError({
                    cause: new Error("Multipart object storage is unavailable"),
                    operation: "complete_multipart",
                  }),
                );
              }
              yield* storage.completeMultipartUpload(
                key,
                file.multipart.uploadId,
                file.multipart.parts,
                { scope: "private" },
              );
            }),
          { concurrency: 2 },
        );

                return {
                  mismatch: { filename: file.name, archivedOriginal: false },
                  bytes: 0,
                };
              }
              const archivedKey = buildTransferArchivedOriginalStorageKey(transferId, file);
              if (!archivedKey) return { mismatch: null, bytes: primary.size };
              const archived = yield* storage.headObject(archivedKey, { scope: "private" });
              if (!archived.exists || archived.size !== file.originalSize) {
                return {
                  mismatch: { filename: file.name, archivedOriginal: true },
                  bytes: primary.size,
                };
              }
              return { mismatch: null, bytes: primary.size + (archived.size ?? 0) };
            }),
          { concurrency: 2 },
        );

      const processFiles = (transferId: string, files: TransferUploadFileInput[]) =>
        Effect.forEach(
          files,
          (file) =>
            attempt(
              "process_uploaded_file",
              () =>
                withObjectStorageProvider(storage.port, () =>
                  processUploadedFile(file, transferId),
                ),
              getInlineProcessingTimeoutMs() || false,
            ).pipe(
              Effect.map((result) => ({
                ...result,
                file: {
                  ...result.file,
                  storedBytes: file.size + (file.originalSize ?? 0),
                },
              })),
            ),
          { concurrency: 2 },
        );

      const presignUpload = (input: {
        transferId: string;
        deleteToken: string;
        actorJti: string;
        expiresSeconds: number;
        files: TransferUploadFileInput[];
        uploadUrlTtlSeconds: number;
      }) =>
        Effect.gen(function* () {
          const reserved = yield* attempt("reserve_upload", () =>
            createTransferUploadReservation({
              transferId: input.transferId,
              deleteToken: input.deleteToken,
              actorJti: input.actorJti,
              expiresSeconds: input.expiresSeconds,
              filesFingerprint: transferUploadFilesFingerprint(input.files),
              createdAt: new Date().toISOString(),
            }),
          );
          if (!reserved) return { status: "reservation-conflict" } as const;

          return yield* presignFiles(input.transferId, input.files, input.uploadUrlTtlSeconds).pipe(
            Effect.map((urls) => ({ status: "ready", urls }) as const),
            Effect.tapError(() =>
              attempt("release_failed_reservation", () =>
                deleteTransferUploadReservation(input.transferId),
              ).pipe(Effect.catch(() => Effect.void)),
            ),
            Effect.withSpan("transfers.presign_upload", {
              attributes: { fileCount: input.files.length },
            }),
          );
        });

      const finalizeUpload = (input: {
        transferId: string;
        deleteToken: string;
        actorJti: string;
        title?: string;
        expiresSeconds: number;
        files: TransferUploadFileInput[];
        maxTotalBytes?: number;
      }) =>
        Effect.gen(function* () {
          const reservation = yield* attempt("read_reservation", () =>
            getTransferUploadReservation(input.transferId),
          );
          if (!reservation) {
            return (
              (yield* findCompleted(input.transferId, input.deleteToken)) ??
              ({
                status: "missing-reservation",
              } as const)
            );
          }
          if (
            reservation.actorJti !== input.actorJti ||
            reservation.deleteToken !== input.deleteToken ||
            reservation.expiresSeconds !== input.expiresSeconds ||
            reservation.filesFingerprint !== transferUploadFilesFingerprint(input.files)
          ) {
            return { status: "reservation-mismatch" } as const;
          }

          const inspected = yield* inspectUploadedFiles(input.transferId, input.files);
          const mismatch = inspected.find((entry) => entry.mismatch)?.mismatch;
          if (mismatch) return { status: "size-mismatch", ...mismatch } as const;
          const actualUploadedBytes = inspected.reduce((sum, entry) => sum + entry.bytes, 0);
          if (input.maxTotalBytes !== undefined && actualUploadedBytes > input.maxTotalBytes) {
            return { status: "too-large", actualUploadedBytes } as const;
          }

          const results = yield* processFiles(input.transferId, input.files);
          const grouped = applyTransferAssetGroups(
            sortTransferFiles(results.map(({ file }) => file)),
          yield* completeMultipartFiles(input.transferId, input.files);
          );
          const now = new Date();
          const transfer: TransferData = {
            id: input.transferId,
            title: normaliseTransferTitle(input.title),
            files: grouped.files,
            groups: grouped.groups,
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + input.expiresSeconds * 1000).toISOString(),
            deleteToken: input.deleteToken,
          };
          const created = yield* attempt("create_transfer", () =>
            createTransfer(transfer, input.expiresSeconds),
          );
          if (!created) {
            return (
              (yield* findCompleted(input.transferId, input.deleteToken)) ??
              ({
                status: "transfer-conflict",
              } as const)
            );
          }
          yield* attempt("release_reservation", () =>
            deleteTransferUploadReservation(input.transferId),
          ).pipe(Effect.catch(() => Effect.void));
          const result = completed(transfer, false);
          if (result.status !== "completed") return result;
          return {
            ...result,
            totalSize: results.reduce((sum, entry) => sum + entry.uploadedBytes, 0),
          };
        }).pipe(
          Effect.timeout(5 * 60_000),
          Effect.withSpan("transfers.finalize_upload", {
            attributes: { fileCount: input.files.length },
          }),
        );

      const resumeUpload = (input: {
        transferId: string;
        deleteToken: string;
        actorJti: string;
        files: TransferUploadFileInput[];
        uploadUrlTtlSeconds: number;
      }) =>
        Effect.gen(function* () {
          const reservation = yield* attempt("read_resume_reservation", () =>
            getTransferUploadReservation(input.transferId),
          );
          if (!reservation) return { status: "missing-reservation" } as const;
          if (
            reservation.actorJti !== input.actorJti ||
            reservation.deleteToken !== input.deleteToken ||
            reservation.filesFingerprint !== transferUploadFilesFingerprint(input.files)
          ) {
            return { status: "reservation-mismatch" } as const;
          }

          const inspected = yield* inspectUploadedFiles(input.transferId, input.files);
          const missingFiles = input.files.filter((_, index) => inspected[index]?.mismatch);
          const urls = yield* presignFiles(
            input.transferId,
            missingFiles,
            input.uploadUrlTtlSeconds,
          );
          return {
            status: "ready",
            urls,
            uploadedNames: input.files
              .filter((_, index) => !inspected[index]?.mismatch)
          yield* completeMultipartFiles(input.transferId, input.files);
              .map((file) => file.name),
          } as const;
        }).pipe(
          Effect.withSpan("transfers.resume_upload", {
            attributes: { fileCount: input.files.length },
          }),
        );

      const abandonUpload = (input: {
        transferId: string;
        deleteToken: string;
        actorJti: string;
      }) =>
        Effect.gen(function* () {
          const reservation = yield* attempt("read_abandon_reservation", () =>
            getTransferUploadReservation(input.transferId),
          );
          if (!reservation) return { status: "missing-reservation" } as const;
          if (
            reservation.actorJti !== input.actorJti ||
            reservation.deleteToken !== input.deleteToken
          ) {
            return { status: "reservation-mismatch" } as const;
          }

          // Keep the reservation until object deletion succeeds. That prevents
          // deep cleanup from racing an explicit discard and makes retries safe.
          const deletedObjects = yield* removeObjects(input.transferId);
          yield* attempt("release_abandoned_reservation", () =>
            deleteTransferUploadReservation(input.transferId),
          );
          return { status: "abandoned", deletedObjects } as const;
        }).pipe(Effect.withSpan("transfers.abandon_upload"));

      const presignAppend = (input: {
        transferId: string;
        files: TransferUploadFileInput[];
        uploadUrlTtlSeconds: number;
      }) =>
        presignFiles(input.transferId, input.files, input.uploadUrlTtlSeconds).pipe(
          Effect.map((urls) => ({ status: "ready", urls }) as const),
          Effect.withSpan("transfers.presign_append", {
            attributes: { fileCount: input.files.length },
          }),
        );

      const finalizeAppend = (input: {
        transferId: string;
        files: TransferUploadFileInput[];
        maxFiles?: number;
        maxTotalBytes?: number;
      }) =>
        Effect.gen(function* () {
          const inspected = yield* inspectUploadedFiles(input.transferId, input.files);
          const mismatch = inspected.find((entry) => entry.mismatch)?.mismatch;
          if (mismatch) return { status: "size-mismatch", ...mismatch } as const;

          const results = yield* processFiles(input.transferId, input.files);
          const appended = yield* attempt("append_files", () =>
            appendTransferFiles(
              input.transferId,
              results.map(({ file }) => file),
              { maxFiles: input.maxFiles, maxTotalBytes: input.maxTotalBytes },
            ),
          );
          yield* completeMultipartFiles(input.transferId, input.files);
          if (appended.status !== "updated") return { status: appended.status } as const;

          let latest = appended.transfer;
          for (let groupingAttempt = 0; groupingAttempt < 3; groupingAttempt += 1) {
            const grouped = applyTransferAssetGroups(sortTransferFiles(latest.files));
            const updated = yield* attempt("group_appended_files", () =>
              updateTransferGrouping(input.transferId, grouped.files, grouped.groups),
            );
            if (updated) break;
            const refreshed = yield* attempt("refresh_appended_files", () =>
              getTransfer(input.transferId),
            );
            if (!refreshed) return { status: "missing" } as const;
            latest = refreshed;
          }
          const transfer =
            (yield* attempt("read_appended_transfer", () => getTransfer(input.transferId))) ??
            latest;
          const files = results.map(({ file }) => file);
          return {
            status: "completed",
            transfer,
            addedCount: results.length,
            totalSize: results.reduce((sum, result) => sum + result.uploadedBytes, 0),
            fileCounts: countTransferFiles(files),
            processingCounts: buildTransferProcessingCounts(files),
          } as const;
        }).pipe(
          Effect.timeout(5 * 60_000),
          Effect.withSpan("transfers.finalize_append", {
            attributes: { fileCount: input.files.length },
          }),
        );

      const removeFile = (input: { id: string; fileId: string; token: string }) =>
        Effect.gen(function* () {
          const authorised = yield* attempt("authorise_file_removal", () =>
            validateDeleteToken(input.id, input.token),
          );
          if (!authorised) return { status: "unauthorised" } as const;
          const transfer = yield* attempt("read_file_removal", () => getTransfer(input.id));
          if (!transfer) return { status: "missing" } as const;
          const file = transfer.files.find(({ id }) => id === input.fileId);
          if (!file) return { status: "file-missing" } as const;

          const keys = storage.port.isTransferStorageConfigured()
            ? getTransferFileDeleteKeys(input.id, file)
            : [];
          let deletedObjects =
            keys.length > 0 ? yield* storage.deleteObjects(keys, { scope: "private" }) : 0;
          const removal = yield* attempt("remove_file_metadata", () =>
            removeTransferFileAtomic(input.id, input.fileId),
          );
          if (removal.status === "deleted") {
            return { status: "deleted", deletedObjects } as const;
          }
          if ("transfer" in removal) {
            if (keys.length > 0) {
              deletedObjects += yield* storage.deleteObjects(keys, { scope: "private" });
            }
            return { status: "updated", deletedObjects, transfer: removal.transfer } as const;
          }
          if (removal.status === "missing") return { status: "missing" } as const;
          return { status: "file-missing" } as const;
        }).pipe(Effect.withSpan("transfers.remove_file"));

      const nuke = Effect.gen(function* () {
        const client = yield* redis.client;
        if (!client || !storage.port.isTransferStorageConfigured()) {
          return { configured: false } as const;
        }
        const objects = yield* storage.listObjects("transfers/", { scope: "private" });
        const keys = objects.map(({ key }) => key).filter((key) => key.startsWith("transfers/"));
        const deletedFiles =
          keys.length > 0 ? yield* storage.deleteObjects(keys, { scope: "private" }) : 0;
        const indexedIds = yield* redisCommand("nuke_list", () =>
          client.smembers("transfer:index"),
        );
        yield* redisCommand("nuke_metadata", async () => {
          const pipeline = client.pipeline();
          indexedIds.forEach((id) => pipeline.del(`transfer:${id}`));
          pipeline.del("transfer:index");
          await pipeline.exec();
        });
        return {
          configured: true,
          deletedFiles,
          deletedTransfers: indexedIds.length,
          timestamp: new Date().toISOString(),
        };
      }).pipe(Effect.withSpan("transfers.nuke"));

      return {
        abandonUpload,
        adminDelete: (id) =>
          Effect.gen(function* () {
            if (!isSafeTransferId(id)) {
              return yield* Effect.fail(
                new TransferOperationError({
                  cause: new Error("Invalid transfer id"),
                  operation: "admin_delete",
                }),
              );
            }
            const deletedFiles = yield* removeObjects(id);
            const dataDeleted = yield* attempt("delete_metadata", () => deleteTransferData(id));
            return { deletedFiles, dataDeleted };
          }),
        cleanup,
        finalizeAppend,
        finalizeUpload,
        nuke,
        presignAppend,
        presignUpload,
        resumeUpload,
        removeFile,
        takedown,
      };
    }),
  );
}

export type TransferOperationsFailure = InfrastructureError | TransferOperationError;
