import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import { stagePostgresTransferOrphanObjects } from "@/features/transfers/orphan-cleanup-postgres.server";
import { runTransferObjectDeletionBatch } from "@/features/transfers/object-deletions.server";
import type { TransferData } from "@/features/transfers/types";
import { createPostgresTransferUploadReservation } from "@/features/transfers/upload-reservation-postgres.server";
import { transferUploadFilesFingerprint } from "@/features/transfers/upload-reservation.server";
import { query } from "@/lib/platform/postgres.server";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const id = "orphan-cleanup-transfer";
const old = new Date("2026-09-20T00:00:00.000Z");
const cutoff = new Date("2026-09-22T00:00:00.000Z");
const recent = new Date("2026-09-25T00:00:00.000Z");

const transfer: TransferData = {
  id,
  title: "Orphan cleanup",
  deleteToken: "private-token",
  createdAt: "2026-09-20T00:00:00.000Z",
  expiresAt: "2026-10-20T00:00:00.000Z",
  files: [
    {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 10,
      mimeType: "image/jpeg",
      storageKey: `transfers/${id}/originals/photo.jpg`,
    },
  ],
};

describeWithDatabase("Postgres transfer orphan cleanup", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
    await query("truncate media_object_operations");
  });

  it("keeps referenced and recent objects while staging an old unreferenced object", async () => {
    await createPostgresTransfer(transfer);
    expect(
      await stagePostgresTransferOrphanObjects(
        id,
        [
          { key: transfer.files[0].storageKey, lastModified: old },
          { key: `transfers/${id}/originals/abandoned.jpg`, lastModified: old },
          { key: `transfers/${id}/originals/in-flight.jpg`, lastModified: recent },
        ],
        cutoff,
      ),
    ).toBe(1);
    expect(
      await query<{ target_key: string }>(
        "select target_key from media_object_operations where owner_kind='transfer' and owner_id=$1",
        [id],
      ),
    ).toEqual([{ target_key: `transfers/${id}/originals/abandoned.jpg` }]);
  });

  it("skips a live presign reservation and restages a later orphan after completion", async () => {
    const orphanId = "orphan-reservation-one";
    const files = [{ mediaId: "photo", name: "photo.jpg", size: 10 }];
    expect(
      await createPostgresTransferUploadReservation(
        {
          transferId: orphanId,
          deleteToken: "private-token",
          actorJti: "actor",
          filesFingerprint: transferUploadFilesFingerprint(files),
          expiresSeconds: 3600,
          createdAt: new Date().toISOString(),
        },
        files,
      ),
    ).toBe(true);
    const objects = [{ key: `transfers/${orphanId}/originals/photo.jpg`, lastModified: old }];
    expect(await stagePostgresTransferOrphanObjects(orphanId, objects, cutoff)).toBe(0);
    await query("delete from transfer_upload_reservations where transfer_id=$1", [orphanId]);
    expect(await stagePostgresTransferOrphanObjects(orphanId, objects, cutoff)).toBe(1);
    expect(
      await createPostgresTransferUploadReservation(
        {
          transferId: orphanId,
          deleteToken: "private-token",
          actorJti: "actor",
          filesFingerprint: transferUploadFilesFingerprint(files),
          expiresSeconds: 3600,
          createdAt: new Date().toISOString(),
        },
        files,
      ),
    ).toBe(false);
    await query("update media_object_operations set status='completed' where owner_id=$1", [
      orphanId,
    ]);
    expect(await stagePostgresTransferOrphanObjects(orphanId, objects, cutoff)).toBe(1);
    expect(
      await query<{ revisions: number }>(
        "select count(distinct owner_revision)::integer as revisions from media_object_operations where owner_id=$1",
        [orphanId],
      ),
    ).toEqual([{ revisions: 2 }]);
  });

  it("deletes an orphan again when a late upload recreates its key", async () => {
    const orphanId = "orphan-late-upload-one";
    const key = `transfers/${orphanId}/originals/late.jpg`;
    const remove = vi.fn(async () => {});
    const observed = [{ key, lastModified: old }];
    await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      async () => {
        expect(await stagePostgresTransferOrphanObjects(orphanId, observed, cutoff)).toBe(1);
        expect(await runTransferObjectDeletionBatch("orphan-worker")).toMatchObject({
          completed: 1,
        });
        expect(await stagePostgresTransferOrphanObjects(orphanId, observed, cutoff)).toBe(1);
        expect(await runTransferObjectDeletionBatch("orphan-worker")).toMatchObject({
          completed: 1,
        });
      },
    );
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
