import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { createPostgresTransfer } from "@/features/transfers/catalogue-postgres.server";
import {
  cancelObsoletePostgresTransferMediaJobs,
  claimPostgresTransferMediaJobs,
  completePostgresTransferMediaJob,
  enqueuePostgresTransferMediaJob,
  failPostgresTransferMediaJob,
  renewPostgresTransferMediaJob,
} from "@/features/transfers/media-jobs-postgres.server";
import type { TransferMediaJob } from "@/features/transfers/media-queue.server";
import { getGenerationTransferAssetKeys } from "@/features/transfers/media-state";
import type { TransferData } from "@/features/transfers/types";
import { query, transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const transfer: TransferData = {
  id: "queue-capability-one",
  title: "Queued transfer",
  deleteToken: "private-delete-token",
  createdAt: "2026-09-26T18:00:00.000Z",
  expiresAt: "2026-10-03T18:00:00.000Z",
  files: [
    {
      id: "raw-one",
      filename: "raw-one.dng",
      kind: "image",
      size: 100,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/queue-capability-one/original/raw-one.dng",
      processingStatus: "queued",
    },
    {
      id: "raw-two",
      filename: "raw-two.dng",
      kind: "image",
      size: 100,
      mimeType: "image/x-adobe-dng",
      storageKey: "transfers/queue-capability-one/original/raw-two.dng",
      processingStatus: "queued",
    },
  ],
};

function job(id: string): TransferMediaJob {
  const expected = getGenerationTransferAssetKeys(transfer.id, `${id}.dng`, "worker_raw", id, 1);
  return {
    transferId: transfer.id,
    file: { name: `${id}.dng`, mediaId: id, size: 100 },
    mediaId: id,
    storageKey: `transfers/${transfer.id}/original/${id}.dng`,
    mimeType: "image/x-adobe-dng",
    processingRoute: "worker_raw",
    expectedThumbKey: expected.thumbKey,
    expectedFullKey: expected.fullKey,
    attempt: 1,
    enqueuedAt: "2026-09-26T18:01:00.000Z",
  };
}

describeWithDatabase("Postgres transfer media jobs", () => {
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

  it("enqueues with source state and refuses a conflicting replay", async () => {
    await expect(
      transaction((client) =>
        enqueuePostgresTransferMediaJob(
          client,
          { ...job("raw-one"), expectedThumbKey: `transfers/${transfer.id}/thumb/raw-one.webp` },
          1,
        ),
      ),
    ).rejects.toThrow("Transfer media job output generation is invalid");
    await expect(
      transaction(async (client) => {
        await enqueuePostgresTransferMediaJob(client, job("raw-one"), 1);
        throw new Error("source rolled back");
      }),
    ).rejects.toThrow("source rolled back");
    expect(
      await query<{ count: string }>("select count(*)::text as count from transfer_media_jobs"),
    ).toEqual([{ count: "0" }]);
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    expect(
      await transaction((client) => enqueuePostgresTransferMediaJob(client, job("raw-one"), 1)),
    ).toBe(id);
    await expect(
      transaction((client) =>
        enqueuePostgresTransferMediaJob(client, { ...job("raw-one"), mimeType: "changed-type" }, 1),
      ),
    ).rejects.toThrow("Conflicting transfer media job identity");
  });

  it("claims disjoint jobs and fences an expired worker", async () => {
    await transaction(async (client) => {
      await enqueuePostgresTransferMediaJob(client, job("raw-one"), 1);
      await enqueuePostgresTransferMediaJob(client, job("raw-two"), 1);
    });
    const [first, second] = await Promise.all([
      claimPostgresTransferMediaJobs("worker-one"),
      claimPostgresTransferMediaJobs("worker-two"),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]?.id).not.toBe(second[0]?.id);
    expect(first[0]?.job.expectedThumbKey).toContain(`/${first[0]?.claimToken}.webp`);
    const old = first[0];
    if (!old) throw new Error("Expected first claim");
    await query(
      "update transfer_media_jobs set lease_until=now()-interval '1 second' where id=$1",
      [old.id],
    );
    const recovered = (await claimPostgresTransferMediaJobs("worker-three"))[0];
    expect(recovered?.id).toBe(old.id);
    expect(recovered?.claimToken).not.toBe(old.claimToken);
    expect(recovered?.job.expectedThumbKey).not.toBe(old.job.expectedThumbKey);
    expect(
      await query<{ count: string }>(
        "select count(*)::text as count from transfer_media_job_attempt_outputs where job_id=$1",
        [old.id],
      ),
    ).toEqual([{ count: "2" }]);
    expect(await renewPostgresTransferMediaJob(old.id, old.claimToken)).toBe(false);
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, old.id, old.claimToken, null),
      ),
    ).toBe(false);
    const sourceFile = transfer.files.find((file) => file.id === recovered?.job.mediaId);
    if (!sourceFile) throw new Error("Expected source file");
    await expect(
      transaction((client) =>
        completePostgresTransferMediaJob(client, recovered!.id, recovered!.claimToken, {
          ...sourceFile,
          id: "wrong-file",
          processingStatus: "worker_done",
        }),
      ),
    ).rejects.toThrow("Transfer media result does not match claimed source");
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, recovered!.id, recovered!.claimToken, {
          ...sourceFile,
          processingStatus: "worker_done",
          previewStatus: "ready",
          processingBackend: "worker",
        }),
      ),
    ).toBe(true);
    expect(
      await query<{
        processing_status: string;
        derivative_generation: number;
        derivative_claim_token: string;
      }>(
        "select processing_status,derivative_generation,derivative_claim_token from transfer_files where transfer_id=$1 and id=$2",
        [transfer.id, sourceFile.id],
      ),
    ).toEqual([
      {
        processing_status: "worker_done",
        derivative_generation: 1,
        derivative_claim_token: recovered!.claimToken,
      },
    ]);
  });

  it("dead-letters exhausted retries and cancels a superseded generation", async () => {
    const id = await transaction((client) =>
      enqueuePostgresTransferMediaJob(client, job("raw-one"), 1),
    );
    await query("update transfer_media_jobs set max_attempts=2 where id=$1", [id]);
    const first = (await claimPostgresTransferMediaJobs("worker-one"))[0];
    if (!first) throw new Error("Expected claim");
    expect(await failPostgresTransferMediaJob(id, first.claimToken, "processing_failed", 0)).toBe(
      true,
    );
    const second = (await claimPostgresTransferMediaJobs("worker-two"))[0];
    if (!second) throw new Error("Expected retry");
    expect(second.job.deliveryAttempt).toBe(1);
    expect(await failPostgresTransferMediaJob(id, second.claimToken, "processing_failed", 0)).toBe(
      true,
    );
    expect(await claimPostgresTransferMediaJobs("worker-three")).toEqual([]);
    expect(
      await query<{ status: string }>("select status from transfer_media_jobs where id=$1", [id]),
    ).toEqual([{ status: "dead" }]);

    await transaction((client) => enqueuePostgresTransferMediaJob(client, job("raw-two"), 1));
    const obsolete = (await claimPostgresTransferMediaJobs("worker-four"))[0];
    if (!obsolete) throw new Error("Expected obsolete claim");
    await query(
      "update transfer_files set processing_generation=2 where transfer_id=$1 and id='raw-two'",
      [transfer.id],
    );
    expect(
      await transaction((client) =>
        completePostgresTransferMediaJob(client, obsolete.id, obsolete.claimToken, null),
      ),
    ).toBe(false);
    expect(await cancelObsoletePostgresTransferMediaJobs()).toBe(1);
    expect(await claimPostgresTransferMediaJobs("worker-five")).toEqual([]);
  });
});
