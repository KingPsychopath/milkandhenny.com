import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import { auditPostgresTransferSources } from "@/features/transfers/source-object-audit.server";
import type { TransferData } from "@/features/transfers/types";
import {
  r2ObjectStorageProvider,
  withObjectStorageProvider,
} from "@/lib/platform/object-storage-provider-context.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "source-audit-transfer",
  title: "Source audit",
  deleteToken: "private-token",
  createdAt: "2026-09-20T00:00:00.000Z",
  expiresAt: "2026-10-20T00:00:00.000Z",
  files: [
    {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 10,
      storedBytes: 12,
      mimeType: "image/jpeg",
      storageKey: "transfers/source-audit-transfer/originals/photo.jpg",
      originalStorageKey: "transfers/source-audit-transfer/originals/photo-original.heic",
    },
  ],
};

describeWithDatabase("Postgres transfer source audit", () => {
  beforeAll(applySchema);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
    await createPostgresTransfer(transfer);
  });

  it("checks both retained source keys and reports missing and mismatched objects", async () => {
    const head = vi.fn(async (key: string) =>
      key.endsWith("photo.jpg") ? { exists: true, size: 11 } : { exists: false },
    );
    const result = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: head },
      () => auditPostgresTransferSources(),
    );
    expect(result).toEqual({
      filesChecked: 1,
      objectsChecked: 2,
      complete: true,
      issues: [
        {
          transferId: transfer.id,
          fileId: "photo",
          key: transfer.files[0].storageKey,
          kind: "size_mismatch",
          expectedBytes: 10,
          actualBytes: 11,
        },
        {
          transferId: transfer.id,
          fileId: "photo",
          key: transfer.files[0].originalStorageKey,
          kind: "missing",
        },
      ],
    });
    expect(head).toHaveBeenCalledTimes(2);
  });

  it("marks an incomplete bounded scan and propagates object-store errors", async () => {
    await createPostgresTransfer({ ...transfer, id: "source-audit-transfer-two" });
    const head = vi.fn(async () => ({ exists: true, size: 12 }));
    const bounded = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: head },
      () => auditPostgresTransferSources(1),
    );
    expect(bounded).toMatchObject({ filesChecked: 1, complete: false });
    expect(head).toHaveBeenCalledTimes(2);

    await expect(
      withObjectStorageProvider(
        { ...r2ObjectStorageProvider, headObject: vi.fn().mockRejectedValue(new Error("R2 down")) },
        () => auditPostgresTransferSources(),
      ),
    ).rejects.toThrow("R2 down");
  });

  it("compares the primary and archived original against their separate byte counts", async () => {
    const result = await withObjectStorageProvider(
      {
        ...r2ObjectStorageProvider,
        headObject: vi.fn(async (key: string) => ({
          exists: true,
          size: key.endsWith("photo.jpg") ? 10 : 2,
        })),
      },
      () => auditPostgresTransferSources(),
    );
    expect(result.issues).toEqual([]);
  });

  it("treats a missing size on a recorded source as unverified", async () => {
    const result = await withObjectStorageProvider(
      { ...r2ObjectStorageProvider, headObject: vi.fn(async () => ({ exists: true })) },
      () => auditPostgresTransferSources(),
    );
    expect(result.issues).toEqual([
      {
        transferId: transfer.id,
        fileId: "photo",
        key: transfer.files[0].storageKey,
        kind: "size_unverified",
        expectedBytes: 10,
      },
      {
        transferId: transfer.id,
        fileId: "photo",
        key: transfer.files[0].originalStorageKey,
        kind: "size_unverified",
        expectedBytes: 2,
      },
    ]);
  });
});
