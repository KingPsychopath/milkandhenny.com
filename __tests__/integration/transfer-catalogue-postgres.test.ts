import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  appendPostgresTransferFiles,
  createPostgresTransfer,
  finalizePostgresTransferReservation,
  getPostgresTransfer,
  getPostgresTransferForWorker,
  tombstonePostgresTransfer,
  updatePostgresTransferGrouping,
} from "@/features/transfers/catalogue-postgres.server";
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
               'delete-race-job','{}','claimed',now(),1,
               '00000000-0000-0000-0000-000000000112','worker-one',now()+interval '1 hour')`,
      [transfer.id],
    );
    expect(await tombstonePostgresTransfer(transfer.id)).toBe(true);
    expect(await tombstonePostgresTransfer(transfer.id)).toBe(false);
    expect(await getPostgresTransfer(transfer.id)).toBeNull();
    const rows = await query<{ status: string; claim_token: string | null }>(
      "select status,claim_token from transfer_media_jobs where transfer_id=$1",
      [transfer.id],
    );
    expect(rows).toEqual([{ status: "cancelled", claim_token: null }]);
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
    const outcomes = await Promise.all([
      finalizePostgresTransferReservation(transfer, claim.actorJti, 3600, selected),
      finalizePostgresTransferReservation(transfer, claim.actorJti, 3600, selected),
    ]);
    expect(outcomes.sort()).toEqual(["created", "missing-reservation"]);
    expect(await getPostgresTransfer(transfer.id)).toEqual(transfer);
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from transfer_upload_reservations where transfer_id=$1",
      [transfer.id],
    );
    expect(rows[0].count).toBe("0");
  });
});
