import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/features/media/processing.server", () => ({
  processImageVariants: vi.fn(async () => ({
    thumb: { buffer: Buffer.from("thumb"), contentType: "image/webp" },
    full: { buffer: Buffer.from("full"), contentType: "image/webp" },
    width: 20,
    height: 10,
    takenAt: null,
    livePhotoContentId: null,
  })),
}));

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import { runPostgresTransferMediaBatch } from "@/features/transfers/media-job-executor-postgres.server";
import { enqueuePostgresTransferMediaJob } from "@/features/transfers/media-jobs-postgres.server";
import { getGenerationTransferAssetKeys } from "@/features/transfers/media-state";
import type { TransferData } from "@/features/transfers/types";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "executor-capability-one",
  title: "Worker executor",
  deleteToken: "private-token",
  createdAt: "2026-09-26T18:00:00.000Z",
  expiresAt: "2026-10-03T18:00:00.000Z",
  files: [
    {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 100,
      mimeType: "image/jpeg",
      storageKey: "transfers/executor-capability-one/originals/photo.jpg",
      previewStatus: "original_only",
      processingStatus: "queued",
      processingRoute: "worker_image",
    },
  ],
};

describeWithDatabase("Postgres transfer media executor", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
    await createPostgresTransfer(transfer);
    const expected = getGenerationTransferAssetKeys(
      transfer.id,
      "photo.jpg",
      "worker_image",
      "photo",
      1,
    );
    await transaction((client) =>
      enqueuePostgresTransferMediaJob(
        client,
        {
          transferId: transfer.id,
          file: { name: "photo.jpg", mediaId: "photo", size: 100 },
          mediaId: "photo",
          storageKey: transfer.files[0].storageKey,
          mimeType: "image/jpeg",
          processingRoute: "worker_image",
          expectedThumbKey: expected.thumbKey,
          expectedFullKey: expected.fullKey,
          attempt: 1,
          enqueuedAt: "2026-09-26T18:01:00.000Z",
        },
        1,
      ),
    );
  });

  it("writes claim-specific outputs and publishes only after both uploads", async () => {
    const uploaded: string[] = [];
    const result = await withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        downloadBuffer: async () => Buffer.from("source"),
        uploadBuffer: async (key) => {
          uploaded.push(key);
        },
      },
      () => runPostgresTransferMediaBatch("worker-one"),
    );
    expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, obsolete: 0, lostClaim: 0 });
    const rows = await query<{
      processing_status: string;
      derivative_generation: number;
      derivative_claim_token: string;
    }>(
      `select processing_status,derivative_generation,derivative_claim_token
         from transfer_files where transfer_id=$1 and id='photo'`,
      [transfer.id],
    );
    expect(rows[0]).toMatchObject({ processing_status: "worker_done", derivative_generation: 1 });
    expect(uploaded).toEqual([
      `transfers/${transfer.id}/thumb/photo/g1/${rows[0].derivative_claim_token}.webp`,
      `transfers/${transfer.id}/full/photo/g1/${rows[0].derivative_claim_token}.webp`,
    ]);
  });

  it("cannot publish an output from an expired claim after R2 upload", async () => {
    const uploaded: string[] = [];
    const deleted: string[] = [];
    let expireFirstClaim = true;
    const provider = {
      ...r2ObjectStorageProvider,
      downloadBuffer: async () => Buffer.from("source"),
      uploadBuffer: async (key: string) => {
        uploaded.push(key);
        if (expireFirstClaim) {
          expireFirstClaim = false;
          await query(
            "update transfer_media_jobs set lease_until=now()-interval '1 second' where transfer_id=$1",
            [transfer.id],
          );
        }
      },
      deleteObjects: async (keys: string[]) => {
        deleted.push(...keys);
        return keys.length;
      },
    };
    await withObjectStorageProvider(provider, async () => {
      expect(await runPostgresTransferMediaBatch("worker-one")).toMatchObject({ lostClaim: 1 });
      expect(await runPostgresTransferMediaBatch("worker-two")).toMatchObject({ completed: 1 });
    });
    const rows = await query<{ derivative_claim_token: string }>(
      "select derivative_claim_token from transfer_files where transfer_id=$1 and id='photo'",
      [transfer.id],
    );
    expect(uploaded).toHaveLength(4);
    expect(deleted).toEqual(uploaded.slice(0, 2));
    expect(uploaded[2]).toContain(rows[0].derivative_claim_token);
    expect(uploaded[0]).not.toContain(rows[0].derivative_claim_token);
  });
});
