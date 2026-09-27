import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
  appendPostgresTransferFiles,
  cleanupExpiredPostgresTransfers,
  createPostgresTransfer,
  finalizePostgresTransferReservation,
  getPostgresTransfer,
  getPostgresTransferForWorker,
  listPostgresTransferSummaries,
  removePostgresTransferFile,
  tombstoneAllPostgresTransfers,
  tombstonePostgresTransfer,
  updatePostgresTransferGrouping,
  validatePostgresTransferDeleteToken,
} from "@/features/transfers/catalogue-postgres.server";
import { planPostgresTransferMedia } from "@/features/transfers/media-plan-postgres.server";
import { getGenerationTransferAssetKeys } from "@/features/transfers/media-state";
import type { TransferData } from "@/features/transfers/types";
import { createPostgresTransferUploadReservation } from "@/features/transfers/upload-reservation-postgres.server";
import { transferUploadFilesFingerprint } from "@/features/transfers/upload-reservation.server";
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
    await query("truncate media_object_operations");
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

  it("validates only a live transfer's delete capability", async () => {
    await createPostgresTransfer(transfer);
    expect(await validatePostgresTransferDeleteToken(transfer.id, transfer.deleteToken)).toBe(true);
    expect(await validatePostgresTransferDeleteToken(transfer.id, "wrong-token")).toBe(false);
    expect(await validatePostgresTransferDeleteToken(transfer.id, "")).toBe(false);
    await query("update transfers set expires_at=now()-interval '1 second' where id=$1", [
      transfer.id,
    ]);
    expect(await validatePostgresTransferDeleteToken(transfer.id, transfer.deleteToken)).toBe(
      false,
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

  it("serializes concurrent appends against file and byte limits", async () => {
    await createPostgresTransfer(transfer);
    const makeFile = (id: string) => ({
      id,
      filename: `${id}.jpg`,
      kind: "image" as const,
      size: 50,
      mimeType: "image/jpeg",
      storageKey: `transfers/${transfer.id}/original/${id}.jpg`,
    });
    const outcomes = await Promise.all([
      appendPostgresTransferFiles(transfer.id, [makeFile("new-a")], {
        maxFiles: 3,
        maxTotalBytes: 400,
      }),
      appendPostgresTransferFiles(transfer.id, [makeFile("new-b")], {
        maxFiles: 3,
        maxTotalBytes: 400,
      }),
    ]);
    expect(outcomes.map((result) => result.status).sort()).toEqual(["limit", "updated"]);
    expect((await getPostgresTransfer(transfer.id))?.files).toHaveLength(3);
    expect(
      await appendPostgresTransferFiles(transfer.id, [makeFile("photo")], { maxFiles: 10 }),
    ).toEqual({ status: "conflict" });
    expect(
      await appendPostgresTransferFiles(transfer.id, [makeFile("oversize")], {
        maxFiles: 10,
        maxTotalBytes: 320,
      }),
    ).toEqual({ status: "limit" });
  });

  it("regroups and reorders without reverting a worker result", async () => {
    await createPostgresTransfer(transfer);
    await query(
      `update transfer_files set processing_status='worker_done',retry_count=2
        where transfer_id=$1 and id='raw'`,
      [transfer.id],
    );
    const desired = [
      { ...transfer.files[1], groupId: undefined, groupRole: undefined },
      { ...transfer.files[0], groupId: undefined, groupRole: undefined },
    ];
    expect(await updatePostgresTransferGrouping(transfer.id, desired, undefined)).toBe(true);
    const updated = await getPostgresTransfer(transfer.id);
    expect(updated?.files.map((file) => file.id)).toEqual(["raw", "photo"]);
    expect(updated?.groups).toBeUndefined();
    expect(updated?.files[0].processingStatus).toBe("worker_done");
    expect(updated?.files[0].retryCount).toBe(2);
    expect(await updatePostgresTransferGrouping(transfer.id, [desired[0]], undefined)).toBe(false);
    await expect(
      updatePostgresTransferGrouping(transfer.id, desired, [transfer.groups![0]]),
    ).rejects.toThrow("Invalid transfer group member");
    expect((await getPostgresTransfer(transfer.id))?.groups).toBeUndefined();
  });

  it("tombstones a transfer and cancels claimed media work", async () => {
    await createPostgresTransfer(transfer);
    await query(
      `insert into transfer_media_jobs
         (id,transfer_id,file_id,operation,generation,idempotency_key,payload,
          status,enqueued_at,attempts,claim_token,claim_owner,lease_until)
       values ('00000000-0000-0000-0000-000000000111',$1,'raw','process',1,
               'delete-race-job',$2::jsonb,'claimed',now(),1,
               '00000000-0000-0000-0000-000000000112','worker-one',now()+interval '1 hour')`,
      [
        transfer.id,
        JSON.stringify({ expectedThumbKey: `transfers/${transfer.id}/thumb/raw/g1.webp` }),
      ],
    );
    await query(
      `insert into transfer_media_job_attempt_outputs
         (job_id,claim_token,thumb_key)
       values ('00000000-0000-0000-0000-000000000111',
               '00000000-0000-0000-0000-000000000112',$1)`,
      [`transfers/${transfer.id}/thumb/raw/g1/00000000-0000-0000-0000-000000000112.webp`],
    );
    expect(await tombstonePostgresTransfer(transfer.id)).toBe(true);
    expect(await tombstonePostgresTransfer(transfer.id)).toBe(false);
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    const rows = await query<{ status: string; claim_token: string | null }>(
      "select status,claim_token from transfer_media_jobs where transfer_id=$1",
      [transfer.id],
    );
    expect(rows).toEqual([{ status: "cancelled", claim_token: null }]);
    const operations = await query<{ target_key: string }>(
      `select target_key from media_object_operations
        where owner_kind='transfer' and owner_id=$1 and operation='delete'
        order by target_key`,
      [transfer.id],
    );
    expect(operations.map((operation) => operation.target_key)).toContain(
      transfer.files[0].storageKey,
    );
    expect(operations.map((operation) => operation.target_key)).toContain(
      transfer.files[1].storageKey,
    );
    expect(operations.map((operation) => operation.target_key)).toContain(
      `transfers/${transfer.id}/thumb/raw/g1.webp`,
    );
    expect(operations.map((operation) => operation.target_key)).toContain(
      `transfers/${transfer.id}/thumb/raw/g1/00000000-0000-0000-0000-000000000112.webp`,
    );
    expect(operations.length).toBeGreaterThanOrEqual(2);
  });

  it("hard-resets current transfers through the durable object ledger", async () => {
    await createPostgresTransfer(transfer);
    const second = {
      ...transfer,
      id: "catalogue-capability-two",
      files: transfer.files.map((file) => ({
        ...file,
        storageKey: file.storageKey.replace(transfer.id, "catalogue-capability-two"),
      })),
    };
    await createPostgresTransfer(second);
    expect(await tombstoneAllPostgresTransfers()).toEqual({
      deletedTransfers: 2,
      stagedFiles: 4,
    });
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    expect(await getPostgresTransfer(second.id)).toBeNull();
    expect(await tombstoneAllPostgresTransfers()).toEqual({
      deletedTransfers: 0,
      stagedFiles: 0,
    });
    const operations = await query<{ count: string }>(
      `select count(*)::text as count from media_object_operations
        where owner_kind='transfer' and status='pending'`,
    );
    expect(Number(operations[0]?.count)).toBeGreaterThanOrEqual(4);
  });

  it("runs the hard reset through the media service without Redis", async () => {
    vi.stubEnv("TRANSFER_CATALOGUE_STORE", "postgres");
    vi.stubEnv("TRANSFER_MEDIA_JOB_STORE", "postgres");
    vi.stubEnv("REDIS_REST_URL", "");
    vi.stubEnv("REDIS_REST_TOKEN", "");
    await createPostgresTransfer(transfer);
    const { runMediaEffect } = await import("@/features/system/media-worker-runtime.server");
    const { TransferOperationsService } =
      await import("@/features/transfers/transfer-operations-service.server");
    const result = await runMediaEffect(
      Effect.gen(function* () {
        return yield* (yield* TransferOperationsService).nuke;
      }),
    );
    expect(result).toMatchObject({
      configured: true,
      deletedTransfers: 1,
      stagedFiles: 2,
      deletedFiles: 0,
    });
  });

  it("rolls back a tombstone when durable cleanup cannot be recorded", async () => {
    await createPostgresTransfer(transfer);
    await query(
      "update transfer_files set storage_key='/invalid' where transfer_id=$1 and id='raw'",
      [transfer.id],
    );
    await expect(tombstonePostgresTransfer(transfer.id)).rejects.toThrow(
      "Invalid media object operation",
    );
    expect(await getPostgresTransfer(transfer.id)).not.toBeNull();
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from media_object_operations where owner_kind='transfer'",
    );
    expect(rows[0].count).toBe("0");
  });

  it("consumes the presign reservation in the transfer creation transaction", async () => {
    const selected = [
      { name: "photo.jpg", mediaId: "photo", size: 100, originalSize: 20 },
      { name: "photo.dng", mediaId: "raw", size: 200 },
    ];
    const claim = {
      transferId: transfer.id,
      deleteToken: transfer.deleteToken,
      actorJti: "actor-one",
      expiresSeconds: 3600,
      filesFingerprint: transferUploadFilesFingerprint(selected),
      createdAt: "2026-09-26T18:00:00.000Z",
    };
    const expected = getGenerationTransferAssetKeys(
      transfer.id,
      "photo.dng",
      "worker_raw",
      "raw",
      1,
    );
    const rawJob = {
      transferId: transfer.id,
      file: selected[1],
      mediaId: "raw",
      storageKey: transfer.files[1].storageKey,
      mimeType: "image/x-adobe-dng",
      processingRoute: "worker_raw" as const,
      attempt: 1,
      enqueuedAt: transfer.files[1].enqueuedAt!,
      expectedThumbKey: expected.thumbKey,
      expectedFullKey: expected.fullKey,
    };
    expect(await createPostgresTransferUploadReservation(claim, selected)).toBe(true);
    expect(await finalizePostgresTransferReservation(transfer, "wrong-actor", 3600, selected)).toBe(
      "reservation-mismatch",
    );
    expect(
      await finalizePostgresTransferReservation(
        { ...transfer, files: [{ ...transfer.files[0], id: "unreserved" }, transfer.files[1]] },
        claim.actorJti,
        3600,
        selected,
      ),
    ).toBe("too-large");
    expect(
      await finalizePostgresTransferReservation(
        { ...transfer, files: [{ ...transfer.files[0], storedBytes: 400 }, transfer.files[1]] },
        claim.actorJti,
        3600,
        selected,
      ),
    ).toBe("too-large");
    await expect(
      finalizePostgresTransferReservation(transfer, claim.actorJti, 3600, selected),
    ).rejects.toThrow("Incomplete transfer media job plan");
    const outcomes = await Promise.all([
      finalizePostgresTransferReservation(transfer, claim.actorJti, 3600, selected, [rawJob]),
      finalizePostgresTransferReservation(transfer, claim.actorJti, 3600, selected, [rawJob]),
    ]);
    expect(outcomes.sort()).toEqual(["created", "missing-reservation"]);
    expect(await getPostgresTransfer(transfer.id)).toEqual(transfer);
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from transfer_upload_reservations where transfer_id=$1",
      [transfer.id],
    );
    expect(rows[0].count).toBe("0");
  });

  it("removes one file with its group and jobs, then tombstones the last file", async () => {
    await createPostgresTransfer(transfer);
    await query(
      `insert into transfer_media_jobs
         (id,transfer_id,file_id,operation,generation,idempotency_key,payload,enqueued_at)
       values ('00000000-0000-0000-0000-000000000211',$1,'raw','process',1,
               'file-delete-job',$2::jsonb,now())`,
      [
        transfer.id,
        JSON.stringify({ expectedThumbKey: `transfers/${transfer.id}/thumb/raw/g1.webp` }),
      ],
    );
    await query(
      `insert into transfer_media_job_attempt_outputs
         (job_id,claim_token,thumb_key)
       values ('00000000-0000-0000-0000-000000000211',
               '00000000-0000-0000-0000-000000000212',$1)`,
      [`transfers/${transfer.id}/thumb/raw/g1/00000000-0000-0000-0000-000000000212.webp`],
    );
    expect(await removePostgresTransferFile(transfer.id, "absent")).toBe("file-missing");
    expect(await removePostgresTransferFile(transfer.id, "raw")).toBe("updated");
    const remaining = await getPostgresTransfer(transfer.id);
    expect(remaining?.files).toHaveLength(1);
    expect(remaining?.files[0].id).toBe("photo");
    expect(remaining?.groups).toBeUndefined();
    expect(
      await query<{ count: string }>("select count(*)::text as count from transfer_media_jobs"),
    ).toEqual([{ count: "0" }]);
    const keys = await query<{ target_key: string }>(
      "select target_key from media_object_operations where owner_kind='transfer'",
    );
    expect(keys.map((row) => row.target_key)).toContain(transfer.files[1].storageKey);
    expect(keys.map((row) => row.target_key)).toContain(
      `transfers/${transfer.id}/thumb/raw/g1/00000000-0000-0000-0000-000000000212.webp`,
    );
    expect(await removePostgresTransferFile(transfer.id, "photo")).toBe("deleted");
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    expect(await removePostgresTransferFile(transfer.id, "photo")).toBe("missing");
  });

  it("keeps the file if its object deletion cannot be staged", async () => {
    await createPostgresTransfer(transfer);
    await query(
      "update transfer_files set storage_key='../bad' where transfer_id=$1 and id='raw'",
      [transfer.id],
    );
    await expect(removePostgresTransferFile(transfer.id, "raw")).rejects.toThrow(
      "Invalid media object operation",
    );
    expect((await getPostgresTransfer(transfer.id))?.files).toHaveLength(2);
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from media_object_operations where owner_kind='transfer'",
      ),
    ).toEqual([{ count: "0" }]);
  });

  it("tombstones expired transfers and records their object cleanup once", async () => {
    await createPostgresTransfer(transfer);
    expect(await cleanupExpiredPostgresTransfers()).toBe(0);
    await query("update transfers set expires_at=now()-interval '1 second' where id=$1", [
      transfer.id,
    ]);
    expect(await cleanupExpiredPostgresTransfers()).toBe(1);
    expect(await cleanupExpiredPostgresTransfers()).toBe(0);
    expect(
      await query<{ deleted: boolean }>(
        "select deleted_at is not null as deleted from transfers where id=$1",
        [transfer.id],
      ),
    ).toEqual([{ deleted: true }]);
    const operations = await query<{ target_key: string }>(
      "select target_key from media_object_operations where owner_kind='transfer'",
    );
    expect(operations.map((operation) => operation.target_key)).toContain(
      transfer.files[0].storageKey,
    );
  });

  it("commits planned visual jobs atomically with a new transfer", async () => {
    const selected = [
      { name: "photo.jpg", mediaId: "photo", size: 100 },
      { name: "notes.pdf", mediaId: "notes", size: 20 },
    ];
    const planned = planPostgresTransferMedia(transfer.id, selected);
    expect(planned.files.map((file) => file.processingStatus)).toEqual(["queued", "skipped"]);
    expect(planned.jobs).toHaveLength(1);
    const data = { ...transfer, files: planned.files, groups: [] };
    const claim = {
      transferId: transfer.id,
      deleteToken: transfer.deleteToken,
      actorJti: "actor-one",
      expiresSeconds: 3600,
      filesFingerprint: transferUploadFilesFingerprint(selected),
      createdAt: new Date().toISOString(),
    };
    expect(await createPostgresTransferUploadReservation(claim, selected)).toBe(true);
    await expect(
      finalizePostgresTransferReservation(data, claim.actorJti, 3600, selected, [
        { ...planned.jobs[0], expectedThumbKey: "wrong" },
      ]),
    ).rejects.toThrow("output generation is invalid");
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    expect(
      await query<{ count: string }>("select count(*)::text as count from transfer_media_jobs"),
    ).toEqual([{ count: "0" }]);
    expect(
      await finalizePostgresTransferReservation(data, claim.actorJti, 3600, selected, planned.jobs),
    ).toBe("created");
    expect(
      await query<{ count: string }>("select count(*)::text as count from transfer_media_jobs"),
    ).toEqual([{ count: "1" }]);
  });

  it("lists active summaries in SQL and filters by owner", async () => {
    await createPostgresTransfer(transfer);
    expect(await listPostgresTransferSummaries()).toMatchObject([
      { id: transfer.id, fileCount: 2, title: transfer.title },
    ]);
    expect(await listPostgresTransferSummaries("00000000-0000-0000-0000-000000000001")).toEqual([]);
    await tombstonePostgresTransfer(transfer.id);
    expect(await listPostgresTransferSummaries()).toEqual([]);
  });
});
