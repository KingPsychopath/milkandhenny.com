import { Effect, Layer } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { getPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import {
  createTransfer,
  getTransfer,
  listTransfers,
  validateDeleteToken,
} from "@/features/transfers/store.server";
import { ObjectStorageService, RedisService } from "@/lib/platform/provider-services.server";
import { r2ObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const layer = TransferOperationsService.layer.pipe(
  Layer.provide(Layer.mergeAll(ObjectStorageService.layer, RedisService.layer)),
);

function run<A, E>(effect: Effect.Effect<A, E, TransferOperationsService>) {
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

describeWithDatabase("Postgres transfer upload workflow", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    await query("truncate transfers cascade");
    await query("truncate media_object_operations");
    vi.spyOn(r2ObjectStorageProvider, "presignPutUrl").mockResolvedValue(
      "https://example.test/put",
    );
    vi.spyOn(r2ObjectStorageProvider, "headObject").mockResolvedValue({ exists: true, size: 123 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("commits upload metadata and its media job together without a Redis writer", async () => {
    const files = [{ mediaId: "photo", name: "photo.jpg", size: 123, type: "image/jpeg" }];
    const input = {
      transferId: "postgres-upload-one",
      deleteToken: "private-token",
      actorJti: "upload-session",
      expiresSeconds: 3600,
      files,
    };
    expect(
      await run(
        TransferOperationsService.use((service) =>
          service.presignUpload({ ...input, uploadUrlTtlSeconds: 3600 }),
        ),
      ),
    ).toMatchObject({ status: "ready" });
    const finalized = await run(
      TransferOperationsService.use((service) => service.finalizeUpload(input)),
    );
    expect(finalized).toMatchObject({ status: "completed", totalSize: 123 });
    expect((await getPostgresTransfer(input.transferId))?.files).toMatchObject([
      { id: "photo", processingStatus: "queued", processingRoute: "worker_image" },
    ]);
    expect((await getTransfer(input.transferId))?.id).toBe(input.transferId);
    expect((await listTransfers()).map((transfer) => transfer.id)).toContain(input.transferId);
    expect(await validateDeleteToken(input.transferId, input.deleteToken)).toBe(true);
    expect(await validateDeleteToken(input.transferId, "wrong")).toBe(false);
    await expect(createTransfer((await getTransfer(input.transferId))!, 3600)).rejects.toThrow(
      "Legacy transfer mutation is unavailable",
    );
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_media_jobs where transfer_id=$1",
        [input.transferId],
      ),
    ).toEqual([{ count: "1" }]);
    expect(
      await run(TransferOperationsService.use((service) => service.finalizeUpload(input))),
    ).toMatchObject({
      status: "completed",
      deduplicated: true,
    });
  });

  it("retains the reservation when the uploaded object is missing and allows retry", async () => {
    const input = {
      transferId: "postgres-upload-retry",
      deleteToken: "private-token",
      actorJti: "upload-session",
      expiresSeconds: 3600,
      files: [{ mediaId: "photo", name: "photo.jpg", size: 123 }],
    };
    await run(
      TransferOperationsService.use((service) =>
        service.presignUpload({ ...input, uploadUrlTtlSeconds: 3600 }),
      ),
    );
    vi.mocked(r2ObjectStorageProvider.headObject).mockResolvedValueOnce({ exists: false });
    expect(
      await run(TransferOperationsService.use((service) => service.finalizeUpload(input))),
    ).toMatchObject({
      status: "size-mismatch",
      filename: "photo.jpg",
    });
    expect(await getPostgresTransfer(input.transferId)).toBeNull();
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_upload_reservations where transfer_id=$1",
        [input.transferId],
      ),
    ).toEqual([{ count: "1" }]);
    expect(
      await run(TransferOperationsService.use((service) => service.finalizeUpload(input))),
    ).toMatchObject({
      status: "completed",
    });
  });

  it("reserves append capacity and commits a RAW pair with its job", async () => {
    const initial = {
      transferId: "postgres-append-one",
      deleteToken: "private-token",
      actorJti: "upload-session",
      expiresSeconds: 3600,
      files: [{ mediaId: "photo", name: "photo.jpg", size: 123 }],
    };
    await run(
      TransferOperationsService.use((service) =>
        service.presignUpload({ ...initial, uploadUrlTtlSeconds: 3600 }),
      ),
    );
    await run(TransferOperationsService.use((service) => service.finalizeUpload(initial)));
    const files = [{ mediaId: "raw", name: "photo.dng", size: 123 }];
    expect(
      await run(
        TransferOperationsService.use((service) =>
          service.presignAppend({
            transferId: initial.transferId,
            files,
            uploadUrlTtlSeconds: 3600,
            maxFiles: 2,
            maxTotalBytes: 246,
          }),
        ),
      ),
    ).toMatchObject({ status: "ready" });
    const appended = await run(
      TransferOperationsService.use((service) =>
        service.finalizeAppend({
          transferId: initial.transferId,
          files,
          maxFiles: 2,
          maxTotalBytes: 246,
        }),
      ),
    );
    expect(appended).toMatchObject({ status: "completed", addedCount: 1 });
    const transfer = await getPostgresTransfer(initial.transferId);
    expect(transfer?.groups).toMatchObject([
      { type: "raw_pair", members: [{ fileId: "photo" }, { fileId: "raw" }] },
    ]);
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_media_jobs where transfer_id=$1",
        [initial.transferId],
      ),
    ).toEqual([{ count: "2" }]);
  });
});
