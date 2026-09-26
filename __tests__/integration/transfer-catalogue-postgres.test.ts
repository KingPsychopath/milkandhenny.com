import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  createPostgresTransfer,
  getPostgresTransfer,
  getPostgresTransferForWorker,
} from "@/features/transfers/catalogue-postgres.server";
import type { TransferData } from "@/features/transfers/types";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "catalogue-capability-one",
  title: "Photo transfer",
  deleteToken: "private-delete-token",
  createdAt: "2026-09-26T18:00:00.000Z",
  expiresAt: "2026-10-03T18:00:00.000Z",
  files: [
    {
      id: "photo",
      filename: "photo.jpg",
      kind: "image",
      size: 100,
      storedBytes: 120,
      mimeType: "image/jpeg",
      storageKey: "transfers/catalogue-capability-one/original/photo.jpg",
      groupId: "pair",
      groupRole: "primary",
      previewStatus: "ready",
      processingStatus: "local_done",
    },
    {
      id: "raw",
      filename: "photo.dng",
      kind: "image",
      size: 200,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/catalogue-capability-one/original/photo.dng",
      groupId: "pair",
      groupRole: "raw",
      previewStatus: "original_only",
      processingStatus: "queued",
      processingRoute: "worker_raw",
      enqueuedAt: "2026-09-26T18:01:00.000Z",
    },
  ],
  groups: [
    {
      id: "pair",
      type: "raw_pair",
      members: [
        { fileId: "photo", role: "primary", mimeType: "image/jpeg" },
        { fileId: "raw", role: "raw", mimeType: "image/x-adobe-dng" },
      ],
    },
  ],
};

describeWithDatabase("Postgres transfer catalogue", () => {
  beforeAll(async () => {
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-transfer-secret-at-least-32-bytes");
    await query("truncate transfers cascade");
  });

  it("creates a transfer with files and groups in one commit and preserves read shape", async () => {
    expect(await createPostgresTransfer(transfer)).toBe(true);
    expect(await createPostgresTransfer(transfer)).toBe(false);
    expect(await getPostgresTransfer(transfer.id)).toEqual(transfer);
    const counts = await query<{ files: string; groups: string; members: string }>(
      `select (select count(*)::text from transfer_files) as files,
              (select count(*)::text from transfer_groups) as groups,
              (select count(*)::text from transfer_group_members) as members`,
    );
    expect(counts).toEqual([{ files: "2", groups: "1", members: "2" }]);
  });

  it("lets the worker read metadata without the web token secret", async () => {
    await createPostgresTransfer(transfer);
    vi.stubEnv("AUTH_SECRET", "");
    const worker = await getPostgresTransferForWorker(transfer.id);
    expect(worker?.files).toHaveLength(2);
    expect(worker).not.toHaveProperty("deleteToken");
    await expect(getPostgresTransfer(transfer.id)).rejects.toThrow(
      "Transfer token encryption key unavailable",
    );
  });

  it("rolls back a failed owner FK and hides expired transfers", async () => {
    await expect(
      createPostgresTransfer({
        ...transfer,
        ownerPersonId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    await createPostgresTransfer(transfer);
    await query("update transfers set expires_at=now()-interval '1 second' where id=$1", [
      transfer.id,
    ]);
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
  });
});
