import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { enqueueMediaObjectOperation } from "@/features/media/object-operations.server";
import { runTransferObjectDeletionBatch } from "@/features/transfers/object-deletions.server";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("transfer object deletion executor", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate media_object_operations");
  });

  it("only claims transfer deletions and completes after the R2 call", async () => {
    await transaction(async (client) => {
      await enqueueMediaObjectOperation(client, {
        ownerKind: "transfer",
        ownerId: "transfer-one",
        ownerRevision: 2,
        operation: "delete",
        targetScope: "private",
        targetKey: "transfers/transfer-one/original/photo.jpg",
      });
      await enqueueMediaObjectOperation(client, {
        ownerKind: "word",
        ownerId: "word-one",
        ownerRevision: 1,
        operation: "copy",
        sourceScope: "private",
        sourceKey: "words/source.jpg",
        targetScope: "public",
        targetKey: "words/target.jpg",
      });
    });
    const remove = vi.fn(async () => {});
    const result = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      () => runTransferObjectDeletionBatch("worker-one"),
    );
    expect(result).toEqual({ claimed: 1, completed: 1, retried: 0, lostClaim: 0 });
    expect(remove).toHaveBeenCalledWith("transfers/transfer-one/original/photo.jpg", {
      scope: "private",
    });
    const statuses = await query<{ owner_kind: string; status: string }>(
      "select owner_kind,status from media_object_operations order by owner_kind",
    );
    expect(statuses).toEqual([
      { owner_kind: "transfer", status: "completed" },
      { owner_kind: "word", status: "pending" },
    ]);
  });

  it("retains a failed delete for an idempotent retry", async () => {
    await transaction((client) =>
      enqueueMediaObjectOperation(client, {
        ownerKind: "transfer",
        ownerId: "transfer-two",
        ownerRevision: 1,
        operation: "delete",
        targetScope: "private",
        targetKey: "transfers/transfer-two/original/photo.jpg",
      }),
    );
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValue(undefined);
    await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, deleteObject: remove },
      async () => {
        expect(await runTransferObjectDeletionBatch("worker-one")).toEqual({
          claimed: 1,
          completed: 0,
          retried: 1,
          lostClaim: 0,
        });
        await query(
          "update media_object_operations set available_at=now() where owner_kind='transfer'",
        );
        expect(await runTransferObjectDeletionBatch("worker-one")).toEqual({
          claimed: 1,
          completed: 1,
          retried: 0,
          lostClaim: 0,
        });
      },
    );
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
